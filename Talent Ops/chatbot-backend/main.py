# main.py - Flask version for Python 3.14 compatibility
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import requests

from role_engine import is_allowed
from sql_agent import generate_sql
from supabase_client import get_client
from guardrails import (
    validate_request,
    sanitize_output,
    detect_prompt_injection,
    log_request,
    needs_clarification,
    check_intent_action_resource
)

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "*"])


@app.route("/")
def read_root():
    return jsonify({"message": "TalentOps backend is alive!"})


@app.route("/health")
def health_check():
    return jsonify({"status": "ok"})


def infer_action(message: str):
    """Lightweight intent guess for permission gating before hitting the LLM."""
    text = message.lower()
    if "assign" in text and "task" in text:
        return "assign_tasks"
    if "approve" in text and "leave" in text:
        return "approve_leaves"
    if "payroll" in text or "payslip" in text:
        return "view_payroll_self"
    return None


def _fetch_name_map(supabase, ids):
    """Given a set of profile IDs, return a map id -> {full_name, email}."""
    if not ids:
        return {}
    try:
        resp = (
            supabase.table("profiles")
            .select("id, full_name, email")
            .in_("id", list(ids))
            .execute()
        )
        rows = resp.data or []
        return {r["id"]: {"name": r.get("full_name"), "email": r.get("email")} for r in rows}
    except Exception:
        return {}


def _annotate_with_names(rows, name_map):
    """Add friendly name fields to result rows when IDs are present."""
    annotated = []
    for row in rows:
        if not isinstance(row, dict):
            annotated.append(row)
            continue
        r = dict(row)
        for field, label in [
            ("assigned_to", "assigned_to_name"),
            ("assigned_by", "assigned_by_name"),
            ("employee_id", "employee_name"),
            ("reviewer_id", "reviewer_name"),
        ]:
            pid = r.get(field)
            if pid and pid in name_map:
                r[label] = name_map[pid].get("name") or name_map[pid].get("email")
        annotated.append(r)
    return annotated


@app.route("/chat", methods=["POST"])
def chat():
    body = request.get_json()
    
    user_id = body.get("user_id", "guest")
    role = body.get("role", "employee").lower()
    team_id = body.get("team_id")
    user_message = body.get("message", "")
    
    print(f"\n[CHAT] User: {user_id} | Role: {role} | Message: '{user_message}'")
    
    if not user_message:
        return jsonify({"error": "Message is required"})
    
    # ========== GUARDRAILS LAYER (Enterprise-Grade Security) ==========
    
    # Master validation - runs all guardrails checks
    is_valid, guardrail_message, risk_score = validate_request(
        query=user_message,
        user_id=user_id,
        user_role=role,
        team_id=team_id
    )
    
    if not is_valid:
        # Log the blocked request
        log_request(user_id, role, "blocked", user_message[:50], "denied", risk_score)
        return jsonify({"reply": [], "message": guardrail_message})
    
    # Check if clarification is needed
    needs_clarify, clarify_message = needs_clarification(user_message, role)
    if needs_clarify:
        return jsonify({"reply": [], "message": clarify_message, "needs_input": True})
    
    # ========== END GUARDRAILS ==========
    
    supabase = get_client()

    # STEP 1 - permission gate
    action = infer_action(user_message)
    if action and not is_allowed(role, action):
        log_request(user_id, role, action, "", "denied", 0.0)
        return jsonify({"reply": "forbidden", "reason": f"{role} cannot {action}"})

    # STEP 2 - generate SQL or action
    sql_query = generate_sql(role, user_id, team_id, user_message)
    
    # Force casting for UUID columns to prevent 400 errors with invalid IDs
    # Handle various patterns: "column =", "column=", "column =" etc.
    import re
    uuid_columns = ['assigned_to', 'assigned_by', 'employee_id', 'team_id', 'id', 'reviewer_id', 'manager_id']
    for col in uuid_columns:
        # Pattern: column = 'value' or column='value' (without ::text)
        pattern = rf'\b{col}\s*=\s*(?!.*::text)'
        if re.search(pattern, sql_query) and f'{col}::text' not in sql_query:
            sql_query = re.sub(rf'\b{col}\s*=', f'{col}::text =', sql_query)

    normalized = sql_query.strip().upper().rstrip(".;")
    if normalized == "FORBIDDEN":
        return jsonify({"reply": "forbidden"})

    # STEP 3 - dispatch RPC when LLM returns action JSON
    if sql_query.startswith("{") and "\"action\"" in sql_query:
        try:
            payload = json.loads(sql_query)
            action_name = payload.get("action")
            params = payload.get("params", {})
            
            print(f"[CHAT] Action: {action_name} | Params: {params}")
            
            # Handle chat/greeting responses
            if action_name == "chat":
                return jsonify({"reply": [], "message": payload.get("response", "Hello! How can I help you?")})
            
            # Handle counter questions when info is missing
            if action_name == "need_info":
                return jsonify({"reply": [], "message": payload.get("question", "I need more information to help you."), "needs_input": True})
            
            # Handle forbidden actions (permission denied)
            if action_name == "forbidden":
                return jsonify({"reply": "forbidden", "message": payload.get("message", "You don't have permission to do that.")})
            
            # Handle task assignment by name
            if action_name == "assign_task":
                from datetime import date, timedelta
                
                # Extract all fields from params
                title = params.get("title")
                assignee_name = params.get("assignee_name")
                priority = params.get("priority")
                description = params.get("description")
                start_date = params.get("start_date")
                due_date = params.get("due_date")
                
                # STEP 1: Validate ALL required fields
                missing_fields = []
                if not title:
                    missing_fields.append("task name/title")
                if not assignee_name:
                    missing_fields.append("assignee name")
                if not start_date:
                    missing_fields.append("start date")
                if not due_date:
                    missing_fields.append("due date")
                if not priority:
                    missing_fields.append("priority (low/medium/high)")
                if not description:
                    missing_fields.append("description")
                
                if missing_fields:
                    return jsonify({
                        "reply": [], 
                        "message": f"To create this task, I still need: {', '.join(missing_fields)}. Please provide them.",
                        "needs_input": True
                    })
                
                # STEP 2: Determine if assigning to self or another person
                is_self_assignment = assignee_name.lower() in ["self", "myself", "me"]
                
                # STEP 3: Look up the assignee profile
                if is_self_assignment:
                    # Assign to the current user
                    if user_id and len(user_id) > 30:
                        find_sql = f"SELECT * FROM profiles WHERE id = '{user_id}' LIMIT 1"
                    else:
                        return jsonify({"reply": [], "message": "I couldn't identify your profile. Please try again."})
                    
                    profile_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                    profiles = profile_resp.data or []
                else:
                    # Assign to another person by name - get ALL matches (no LIMIT 1)
                    find_sql = f"SELECT * FROM profiles WHERE full_name ILIKE '%{assignee_name}%'"
                    profile_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                    profiles = profile_resp.data or []
                    
                    # STEP 3b: Handle multiple matches
                    if len(profiles) > 1:
                        # Multiple people with same/similar name - ask for clarification
                        options = []
                        for i, p in enumerate(profiles, 1):
                            name = p.get('full_name', 'Unknown')
                            email = p.get('email', 'no email')
                            role = p.get('role', 'employee')
                            options.append(f"{i}. {name} ({email}) - {role}")
                        
                        options_text = "\n".join(options)
                        return jsonify({
                            "reply": [], 
                            "message": f"I found multiple people matching '{assignee_name}':\n\n{options_text}\n\nPlease specify which one by using their full name or email.",
                            "needs_input": True
                        })
                
                if not profiles:
                    if is_self_assignment:
                        return jsonify({"reply": [], "message": "I couldn't find your profile in the system."})
                    else:
                        return jsonify({"reply": [], "message": f"I couldn't find anyone named '{assignee_name}'. Please check the name."})
                
                assignee_profile = profiles[0]
                assignee_role = assignee_profile.get('role', 'employee').lower()
                
                # STEP 4: Get assigner's (current user) profile
                assigner_profile = None
                assigner_name = "Unknown"
                if user_id and len(user_id) > 30:
                    user_sql = f"SELECT * FROM profiles WHERE id = '{user_id}' LIMIT 1"
                    user_resp = supabase.rpc("execute_sql_chatbot", {"sql": user_sql}).execute()
                    if user_resp.data:
                        assigner_profile = user_resp.data[0]
                        assigner_name = assigner_profile.get('full_name') or assigner_profile.get('email') or "Unknown"
                
                # STEP 5: Role-based permission check (STRICT ENFORCEMENT)
                user_role_lower = role.lower()
                
                if not is_self_assignment:
                    # Check permissions for assigning to others
                    if user_role_lower == 'employee':
                        return jsonify({
                            "reply": "forbidden", 
                            "message": f"❌ As an Employee, you can only add tasks to yourself. You cannot assign tasks to others."
                        })
                    
                    elif user_role_lower == 'team_lead':
                        return jsonify({
                            "reply": "forbidden", 
                            "message": f"❌ As a Team Lead, you can only assign tasks to yourself. You cannot assign tasks to {assignee_name}."
                        })
                    
                    elif user_role_lower == 'manager':
                        if assignee_role == 'executive':
                            return jsonify({
                                "reply": "forbidden", 
                                "message": f"❌ As a Manager, you cannot assign tasks to Executives. You can assign tasks to Team Leads, Employees, or yourself."
                            })
                    
                    # Executive can assign to anyone - no restrictions
                
                # STEP 6: Resolve names for database - be very explicit
                final_assignee_name = assignee_profile.get('full_name')
                if not final_assignee_name:
                    final_assignee_name = assignee_profile.get('name')
                if not final_assignee_name:
                    final_assignee_name = assignee_name
                if not final_assignee_name:
                    final_assignee_name = "Unknown"
                
                # Also ensure assigner_name is set
                if not assigner_name or assigner_name == "Unknown":
                    if assigner_profile:
                        assigner_name = assigner_profile.get('full_name') or assigner_profile.get('email') or "Unknown"
                
                print(f"[TASK] DEBUG - Assignee Profile: {assignee_profile}")
                print(f"[TASK] DEBUG - Assigner Profile: {assigner_profile}")
                print(f"[TASK] Assigner: '{assigner_name}' ({user_role_lower}) -> Assignee: '{final_assignee_name}' ({assignee_role})")
                print(f"[TASK] Is Self Assignment: {is_self_assignment}")
                
                # STEP 7: Build task data with ALL required fields
                task_data = {
                    "title": title,
                    "description": description,
                    "status": "pending",
                    "priority": priority,
                    "assigned_to": assignee_profile.get('id'),
                    "assigned_to_name": final_assignee_name,
                    "assigned_by": user_id if user_id and len(user_id) > 30 else None,
                    "assigned_by_name": assigner_name,
                    "team_id": assignee_profile.get('team_id') or team_id,
                    "start_date": start_date,
                    "due_date": due_date
                }
                
                # Remove None values but NOT empty strings
                task_data = {k: v for k, v in task_data.items() if v is not None}
                
                print(f"[TASK] Final Payload: {task_data}")
                
                # STEP 8: Insert into database
                url = f"{os.getenv('SUPABASE_URL')}/rest/v1/tasks"
                headers = {
                    "apikey": os.getenv('SUPABASE_ANON_KEY'),
                    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                resp = requests.post(url, headers=headers, json=task_data, timeout=30)
                
                print(f"[TASK] Response: {resp.status_code} - {resp.text[:200] if resp.text else 'OK'}")
                
                # STEP 9: Confirm successful creation
                if resp.status_code in [200, 201]:
                    return jsonify({
                        "action": "assign_task",
                        "reply": resp.json(),
                        "message": f"✅ Task Created Successfully!\n\n📋 **{title}**\n👤 Assigned to: {final_assignee_name}\n👤 Assigned by: {assigner_name}\n📅 Start: {start_date}\n📅 Due: {due_date}\n🔴 Priority: {priority}\n📝 Description: {description}"
                    })
                else:
                    return jsonify({"reply": [], "message": f"❌ Failed to create task: {resp.text}"})

            if action_name == "approve_all_leaves":
                # Get all pending leaves
                pending_response = supabase.rpc("execute_sql_chatbot", {"sql": "SELECT * FROM leaves WHERE status = 'pending'"}).execute()
                pending_leaves = pending_response.data or []
                
                if not pending_leaves:
                    return jsonify({"reply": [], "message": "There are no pending leaves to approve."})
                
                # Approve all pending leaves via REST API (since RPC is read-only)
                update_url = f"{os.getenv('SUPABASE_URL')}/rest/v1/leaves?status=eq.pending"
                headers = {
                    "apikey": os.getenv('SUPABASE_ANON_KEY'),
                    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                
                print(f"[LEAVES] Approving all pending leaves via REST: {update_url}")
                resp = requests.patch(update_url, headers=headers, json={"status": "approved"})
                
                if resp.status_code not in (200, 204):
                     print(f"[LEAVES] Error: {resp.text}")
                     return jsonify({"reply": [], "message": f"Failed to approve leaves: {resp.text}"})
                
                updated_leaves = resp.json() if resp.text else []
                
                return jsonify({
                    "action": "approve_all_leaves",
                    "reply": updated_leaves,
                    "message": f"✅ Approved {len(updated_leaves)} pending leave(s)."
                })
            
            # ============ LEAVE MANAGEMENT HANDLERS ============
            
            # APPLY LEAVE - All roles can apply
            if action_name == "apply_leave":
                from_date = params.get("from_date")
                to_date = params.get("to_date")
                reason = params.get("reason")
                leave_type = params.get("leave_type", "casual")
                
                # Validate required fields
                missing = []
                if not from_date:
                    missing.append("from_date (start date)")
                if not to_date:
                    missing.append("to_date (end date)")
                if not reason:
                    missing.append("reason")
                
                if missing:
                    return jsonify({
                        "reply": [],
                        "message": f"To apply for leave, I need: {', '.join(missing)}. Please provide them.",
                        "needs_input": True
                    })
                
                # Get user's profile for employee_id
                if not user_id or len(user_id) < 30:
                    return jsonify({"reply": [], "message": "I couldn't identify your profile. Please try again."})
                
                # Create leave request
                leave_data = {
                    "employee_id": user_id,
                    "from_date": from_date,
                    "to_date": to_date,
                    "reason": reason,
                    "leave_type": leave_type,
                    "status": "pending"
                }
                
                url = f"{os.getenv('SUPABASE_URL')}/rest/v1/leaves"
                headers = {
                    "apikey": os.getenv('SUPABASE_ANON_KEY'),
                    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                
                print(f"[LEAVE] Applying leave: {leave_data}")
                resp = requests.post(url, headers=headers, json=leave_data, timeout=30)
                
                if resp.status_code in [200, 201]:
                    return jsonify({
                        "action": "apply_leave",
                        "reply": resp.json(),
                        "message": f"✅ Leave Request Submitted!\n\n📅 From: {from_date}\n📅 To: {to_date}\n📋 Type: {leave_type}\n📝 Reason: {reason}\n⏳ Status: Pending Approval"
                    })
                else:
                    return jsonify({"reply": [], "message": f"❌ Failed to apply for leave: {resp.text}"})
            
            # APPROVE LEAVE (single) - Manager/Executive only
            if action_name == "approve_leave":
                # Permission check
                if role.lower() not in ['manager', 'executive']:
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ Only Managers and Executives can approve leave requests."
                    })
                
                employee_name = params.get("employee_name")
                
                if not employee_name:
                    return jsonify({
                        "reply": [],
                        "message": "Whose leave do you want to approve? Please specify the employee name.",
                        "needs_input": True
                    })
                
                # Find employee's pending leave
                find_sql = f"SELECT l.*, p.full_name FROM leaves l JOIN profiles p ON l.employee_id = p.id WHERE p.full_name ILIKE '%{employee_name}%' AND l.status = 'pending' LIMIT 1"
                leave_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                leaves = leave_resp.data or []
                
                if not leaves:
                    return jsonify({"reply": [], "message": f"I couldn't find any pending leave request for '{employee_name}'."})
                
                leave = leaves[0]
                leave_id = leave.get('id')
                
                # Approve via REST API
                update_url = f"{os.getenv('SUPABASE_URL')}/rest/v1/leaves?id=eq.{leave_id}"
                headers = {
                    "apikey": os.getenv('SUPABASE_ANON_KEY'),
                    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                
                resp = requests.patch(update_url, headers=headers, json={"status": "approved"})
                
                if resp.status_code in [200, 204]:
                    return jsonify({
                        "action": "approve_leave",
                        "reply": resp.json() if resp.text else [],
                        "message": f"✅ Approved leave for {leave.get('full_name', employee_name)}!\n\n📅 {leave.get('from_date')} to {leave.get('to_date')}"
                    })
                else:
                    return jsonify({"reply": [], "message": f"❌ Failed to approve leave: {resp.text}"})
            
            # REJECT LEAVE - Manager/Executive only
            if action_name == "reject_leave":
                # Permission check
                if role.lower() not in ['manager', 'executive']:
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ Only Managers and Executives can reject leave requests."
                    })
                
                employee_name = params.get("employee_name")
                reject_reason = params.get("reason", "")
                
                if not employee_name:
                    return jsonify({
                        "reply": [],
                        "message": "Whose leave do you want to reject? Please specify the employee name.",
                        "needs_input": True
                    })
                
                # Find employee's pending leave
                find_sql = f"SELECT l.*, p.full_name FROM leaves l JOIN profiles p ON l.employee_id = p.id WHERE p.full_name ILIKE '%{employee_name}%' AND l.status = 'pending' LIMIT 1"
                leave_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                leaves = leave_resp.data or []
                
                if not leaves:
                    return jsonify({"reply": [], "message": f"I couldn't find any pending leave request for '{employee_name}'."})
                
                leave = leaves[0]
                leave_id = leave.get('id')
                
                # Reject via REST API
                update_url = f"{os.getenv('SUPABASE_URL')}/rest/v1/leaves?id=eq.{leave_id}"
                headers = {
                    "apikey": os.getenv('SUPABASE_ANON_KEY'),
                    "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                }
                
                resp = requests.patch(update_url, headers=headers, json={"status": "rejected"})
                
                if resp.status_code in [200, 204]:
                    msg = f"❌ Rejected leave for {leave.get('full_name', employee_name)}."
                    if reject_reason:
                        msg += f"\n📝 Reason: {reject_reason}"
                    return jsonify({
                        "action": "reject_leave",
                        "reply": resp.json() if resp.text else [],
                        "message": msg
                    })
                else:
                    return jsonify({"reply": [], "message": f"❌ Failed to reject leave: {resp.text}"})
            
            # CHECK LEAVE BALANCE - All roles
            if action_name == "check_leave_balance":
                try:
                    # Get user's profile with leave columns
                    profile_sql = f"SELECT * FROM profiles WHERE id::text = '{user_id}'"
                    profile_resp = supabase.rpc("execute_sql_chatbot", {"sql": profile_sql}).execute()
                    profiles = profile_resp.data or []
                    
                    if not profiles:
                        return jsonify({
                            "action": "check_leave_balance",
                            "reply": {},
                            "message": "📊 I couldn't find your profile to check leave balance."
                        })
                    
                    profile = profiles[0]
                    name = profile.get('full_name', 'User')
                    
                    # Use correct column names from your database
                    monthly_quota = profile.get('monthly_leave_quota', 0) or 0
                    taken_this_month = profile.get('leaves_taken_this_month', 0) or 0
                    remaining = profile.get('leaves_remaining', 0) or 0
                    
                    return jsonify({
                        "action": "check_leave_balance",
                        "reply": {
                            "monthly_quota": monthly_quota,
                            "taken": taken_this_month,
                            "remaining": remaining
                        },
                        "message": f"📊 Leave Balance for {name}:\n\n� Monthly Quota: {monthly_quota} days\n📋 Taken This Month: {taken_this_month} days\n✅ Remaining: {remaining} days"
                    })
                    
                except Exception as e:
                    print(f"[LEAVE BALANCE ERROR] {e}")
                    return jsonify({
                        "action": "check_leave_balance",
                        "reply": {},
                        "message": f"📊 Unable to fetch leave balance. Error: {str(e)}"
                    })
            
            # VIEW SOMEONE'S LEAVE BALANCE - Manager/Executive
            if action_name == "view_employee_leave_balance":
                employee_name = params.get("employee_name", "")
                user_role_lower = role.lower()
                
                if not employee_name:
                    return jsonify({"reply": [], "message": "Whose leave balance do you want to check? Please specify the name."})
                
                if user_role_lower == 'employee':
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ As an Employee, you can only check your own leave balance."
                    })
                
                # Find the employee
                find_sql = f"SELECT id, full_name, team_id, monthly_leave_quota, leaves_taken_this_month, leaves_remaining FROM profiles WHERE full_name ILIKE '%{employee_name}%'"
                emp_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                employees = emp_resp.data or []
                
                if not employees:
                    return jsonify({"reply": [], "message": f"I couldn't find anyone named '{employee_name}'."})
                
                emp = employees[0]
                emp_name = emp.get('full_name', employee_name)
                emp_team_id = emp.get('team_id')
                
                # Manager/Team Lead can only view their team members
                if user_role_lower in ['manager', 'team_lead'] and str(emp_team_id) != str(team_id):
                    return jsonify({
                        "reply": "forbidden",
                        "message": f"❌ You can only view leave balance for your team members. {emp_name} is not in your team."
                    })
                
                monthly_quota = emp.get('monthly_leave_quota', 0) or 0
                taken = emp.get('leaves_taken_this_month', 0) or 0
                remaining = emp.get('leaves_remaining', 0) or 0
                
                return jsonify({
                    "action": "view_employee_leave_balance",
                    "reply": emp,
                    "message": f"📊 **Leave Balance for {emp_name}:**\n\n📅 Monthly Quota: {monthly_quota} days\n📋 Taken This Month: {taken} days\n✅ Remaining: {remaining} days"
                })
            
            # CHECK LEAVE STATUS - All roles can check their own
            if action_name == "check_leave_status":
                # Get user's leave requests - use ::text for UUID
                status_sql = f"SELECT * FROM leaves WHERE employee_id::text = '{user_id}' ORDER BY created_at DESC LIMIT 10"
                status_resp = supabase.rpc("execute_sql_chatbot", {"sql": status_sql}).execute()
                leaves = status_resp.data or []
                
                if not leaves:
                    return jsonify({
                        "action": "check_leave_status",
                        "reply": [],
                        "message": "📋 You don't have any leave requests yet."
                    })
                
                # Format leave status
                status_lines = []
                for leave in leaves:
                    status = leave.get('status', 'unknown').upper()
                    status_emoji = "✅" if status == "APPROVED" else "❌" if status == "REJECTED" else "⏳"
                    from_date = leave.get('from_date', 'N/A')
                    to_date = leave.get('to_date', 'N/A')
                    reason = leave.get('reason', 'No reason')
                    status_lines.append(f"{status_emoji} {from_date} to {to_date} - {status}\n   📝 {reason}")
                
                status_text = "\n\n".join(status_lines[:5])  # Show last 5
                
                return jsonify({
                    "action": "check_leave_status",
                    "reply": leaves,
                    "message": f"📋 Your Leave Requests:\n\n{status_text}"
                })
            
            # VIEW PENDING LEAVES - Manager/Executive only
            if action_name == "view_pending_leaves":
                user_role_lower = role.lower()
                
                if user_role_lower == 'employee':
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ As an Employee, you can only view your own leaves. Try 'my leaves'."
                    })
                
                # Executive sees ALL pending leaves, Manager/Team Lead sees their team's
                if user_role_lower == 'executive':
                    pending_sql = f"""
                        SELECT l.*, p.full_name as employee_name 
                        FROM leaves l 
                        JOIN profiles p ON l.employee_id = p.id 
                        WHERE l.status = 'pending' 
                        ORDER BY l.created_at DESC
                    """
                else:
                    # Manager/Team Lead - only their team
                    pending_sql = f"""
                        SELECT l.*, p.full_name as employee_name 
                        FROM leaves l 
                        JOIN profiles p ON l.employee_id = p.id 
                        WHERE l.status = 'pending' AND p.team_id::text = '{team_id}'
                        ORDER BY l.created_at DESC
                    """
                
                pending_resp = supabase.rpc("execute_sql_chatbot", {"sql": pending_sql}).execute()
                pending_leaves = pending_resp.data or []
                
                if not pending_leaves:
                    return jsonify({
                        "action": "view_pending_leaves",
                        "reply": [],
                        "message": "📋 No pending leave requests to review."
                    })
                
                # Format pending leaves
                leave_lines = []
                for leave in pending_leaves:
                    emp_name = leave.get('employee_name', 'Unknown')
                    from_date = leave.get('from_date', 'N/A')
                    to_date = leave.get('to_date', 'N/A')
                    reason = leave.get('reason', 'No reason')
                    leave_type = leave.get('leave_type', 'casual')
                    leave_lines.append(f"⏳ **{emp_name}**\n   📅 {from_date} to {to_date}\n   📝 {reason} ({leave_type})")
                
                leave_text = "\n\n".join(leave_lines[:10])
                return jsonify({
                    "action": "view_pending_leaves",
                    "reply": pending_leaves,
                    "message": f"📋 **Pending Leave Requests** ({len(pending_leaves)} total)\n\n{leave_text}"
                })
            
            # VIEW SOMEONE'S TASKS - Role-based access
            if action_name == "view_employee_tasks":
                employee_name = params.get("employee_name", "")
                status_filter = params.get("status_filter", "all")
                
                if not employee_name:
                    return jsonify({
                        "reply": [],
                        "message": "Whose tasks do you want to see? Please specify the employee name."
                    })
                
                # Find the employee
                find_sql = f"SELECT id, full_name, team_id, role FROM profiles WHERE full_name ILIKE '%{employee_name}%'"
                emp_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                employees = emp_resp.data or []
                
                if not employees:
                    return jsonify({"reply": [], "message": f"I couldn't find anyone named '{employee_name}'."})
                
                # Handle multiple matches
                if len(employees) > 1:
                    options = [f"• {e.get('full_name')} ({e.get('role')})" for e in employees]
                    return jsonify({
                        "reply": [],
                        "message": f"I found multiple people matching '{employee_name}':\n\n" + "\n".join(options) + "\n\nPlease be more specific."
                    })
                
                emp = employees[0]
                emp_id = emp.get('id')
                emp_name = emp.get('full_name', employee_name)
                emp_team_id = emp.get('team_id')
                
                # PERMISSION CHECK
                user_role_lower = role.lower()
                if user_role_lower == 'employee':
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ As an Employee, you can only view your own tasks. Try 'my tasks'."
                    })
                elif user_role_lower in ['team_lead', 'manager']:
                    # Can only view team members
                    if emp_team_id != team_id:
                        return jsonify({
                            "reply": "forbidden",
                            "message": f"❌ You can only view tasks for your team members. {emp_name} is not in your team."
                        })
                # Executive can view anyone - no restriction
                
                # Fetch tasks
                if status_filter == "pending":
                    task_sql = f"SELECT title, priority, status, start_date, due_date FROM tasks WHERE assigned_to::text = '{emp_id}' AND status IN ('pending', 'in_progress')"
                else:
                    task_sql = f"SELECT title, priority, status, start_date, due_date FROM tasks WHERE assigned_to::text = '{emp_id}'"
                
                task_resp = supabase.rpc("execute_sql_chatbot", {"sql": task_sql}).execute()
                tasks = task_resp.data or []
                
                if not tasks:
                    return jsonify({
                        "action": "view_employee_tasks",
                        "reply": [],
                        "message": f"📋 {emp_name} has no {status_filter} tasks."
                    })
                
                # Format tasks
                task_lines = []
                for i, task in enumerate(tasks, 1):
                    title = task.get('title', 'Untitled')
                    status = task.get('status', 'pending') or 'pending'
                    priority = task.get('priority', 'medium') or 'medium'
                    start = task.get('start_date') or 'Not set'
                    due = task.get('due_date') or 'Not set'
                    
                    status_emoji = "✅" if status.lower() in ["completed", "done"] else "🔄" if status.lower() == "in_progress" else "⏳"
                    priority_emoji = "🔴 High" if priority == "high" else "🟡 Medium" if priority == "medium" else "🟢 Low"
                    
                    card = f"""📌 **{i}. {title}**
   • Priority: {priority_emoji}
   • Status: {status_emoji} {status}
   • Start: {start}
   • Due: {due}"""
                    task_lines.append(card)
                
                task_text = "\n\n".join(task_lines[:10])
                return jsonify({
                    "action": "view_employee_tasks",
                    "reply": tasks,
                    "message": f"📋 **{emp_name}'s Tasks** ({len(tasks)} total)\n\n{task_text}"
                })
            
            # GET TASK INFO - Who is working on a task
            if action_name == "get_task_info":
                task_title = params.get("task_title", "")
                
                if not task_title:
                    return jsonify({"reply": [], "message": "Which task? Please provide the task name."})
                
                # Find the task
                task_sql = f"SELECT t.title, t.status, p.full_name as assignee FROM tasks t LEFT JOIN profiles p ON t.assigned_to = p.id WHERE t.title ILIKE '%{task_title}%'"
                task_resp = supabase.rpc("execute_sql_chatbot", {"sql": task_sql}).execute()
                tasks = task_resp.data or []
                
                if not tasks:
                    return jsonify({"reply": [], "message": f"I couldn't find any task named '{task_title}'."})
                
                task = tasks[0]
                title = task.get('title', task_title)
                assignee = task.get('assignee') or 'Not assigned'
                
                return jsonify({
                    "action": "get_task_info",
                    "reply": task,
                    "message": f"👤 **{assignee}** is working on the task **{title}**."
                })
            
            # VIEW TEAM TASKS - Manager/Team Lead/Executive
            if action_name == "view_team_tasks":
                requested_team_name = params.get("team_name")
                
                # Permission check
                user_role_lower = role.lower()
                if user_role_lower == 'employee':
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ As an Employee, you can only view your own tasks. Try 'my tasks'."
                    })
                
                # Determine which team to query
                if requested_team_name:
                    # Manager/Team Lead can only see their own team
                    if user_role_lower in ['manager', 'team_lead']:
                        return jsonify({
                            "reply": [],
                            "message": f"Please use 'my team tasks' to view your team's tasks."
                        })
                    
                    # Executive asking for specific team - show all tasks with that team name pattern
                    # Search for employees with team matching the name
                    task_sql = f"""
                        SELECT t.title, t.status, t.priority, t.start_date, t.due_date, p.full_name as assignee 
                        FROM tasks t 
                        JOIN profiles p ON t.assigned_to = p.id 
                        ORDER BY t.due_date ASC NULLS LAST
                        LIMIT 50
                    """
                    target_team_name = requested_team_name.title()
                else:
                    # Use user's own team
                    if not team_id or team_id == 'None' or team_id == 'null':
                        return jsonify({
                            "reply": [],
                            "message": "❌ Your team is not configured. Please contact your administrator to assign you to a team."
                        })
                    # Fetch tasks for user's team
                    task_sql = f"""
                        SELECT t.title, t.status, t.priority, t.start_date, t.due_date, p.full_name as assignee 
                        FROM tasks t 
                        JOIN profiles p ON t.assigned_to = p.id 
                        WHERE p.team_id::text = '{team_id}'
                        ORDER BY t.due_date ASC NULLS LAST
                    """
                    target_team_name = "Your Team"
                
                task_resp = supabase.rpc("execute_sql_chatbot", {"sql": task_sql}).execute()
                tasks = task_resp.data or []
                
                if not tasks:
                    return jsonify({
                        "action": "view_team_tasks",
                        "reply": [],
                        "message": f"📋 No tasks found."
                    })
                
                # Format tasks with employee names
                task_lines = []
                for i, task in enumerate(tasks, 1):
                    title = task.get('title', 'Untitled')
                    assignee = task.get('assignee', 'Unknown')
                    status = task.get('status', 'pending') or 'pending'
                    priority = task.get('priority', 'medium') or 'medium'
                    due = task.get('due_date') or 'Not set'
                    
                    status_emoji = "✅" if status.lower() in ["completed", "done"] else "🔄" if status.lower() == "in_progress" else "⏳"
                    priority_emoji = "🔴" if priority == "high" else "🟡" if priority == "medium" else "🟢"
                    
                    task_lines.append(f"📌 **{title}**\n   👤 {assignee} | {priority_emoji} {priority} | {status_emoji} {status} | 📅 Due: {due}")
                
                task_text = "\n\n".join(task_lines[:15])
                return jsonify({
                    "action": "view_team_tasks",
                    "reply": tasks,
                    "message": f"📋 **{target_team_name} Team Tasks** ({len(tasks)} total)\n\n{task_text}"
                })
            
            # SCHEDULE MEETING - Manager/Team Lead/Executive only
            if action_name == "schedule_meeting":
                user_role_lower = role.lower()
                
                if user_role_lower == 'employee':
                    return jsonify({
                        "reply": "forbidden",
                        "message": "❌ As an Employee, you cannot schedule meetings. Please contact your manager."
                    })
                
                title = params.get("title", "")
                meeting_date = params.get("date", "")
                meeting_time = params.get("time", "")
                attendees = params.get("attendees", "")
                
                # Convert date if it's a relative term
                from datetime import date, timedelta
                if meeting_date:
                    meeting_date_lower = meeting_date.lower()
                    if 'tomorrow' in meeting_date_lower:
                        meeting_date = (date.today() + timedelta(days=1)).isoformat()
                    elif 'today' in meeting_date_lower:
                        meeting_date = date.today().isoformat()
                    elif 'next week' in meeting_date_lower:
                        meeting_date = (date.today() + timedelta(days=7)).isoformat()
                
                # Check if any required fields are missing
                missing_fields = []
                if not title:
                    missing_fields.append("title")
                if not meeting_date:
                    missing_fields.append("date")
                if not meeting_time:
                    missing_fields.append("time")
                if not attendees:
                    missing_fields.append("attendees")
                
                if missing_fields:
                    return jsonify({
                        "action": "need_info",
                        "reply": {},
                        "message": f"To schedule this meeting, I need: {', '.join(missing_fields)}. Please provide these details."
                    })
                
                # First, find the attendee IDs from profiles
                attendee_names = [name.strip() for name in attendees.split(',')]
                attendee_ids = []
                attendee_full_names = []
                
                print(f"[DEBUG] Looking for attendees: {attendee_names}")
                print(f"[DEBUG] Meeting date: {meeting_date}, time: {meeting_time}")
                
                try:
                    for name in attendee_names:
                        find_sql = f"SELECT id, full_name FROM profiles WHERE full_name ILIKE '%{name}%'"
                        print(f"[DEBUG] Find SQL: {find_sql}")
                        find_resp = supabase.rpc("execute_sql_chatbot", {"sql": find_sql}).execute()
                        if find_resp.data and len(find_resp.data) > 0:
                            attendee_ids.append(find_resp.data[0]['id'])
                            attendee_full_names.append(find_resp.data[0]['full_name'])
                except Exception as e:
                    print(f"[DEBUG] Error finding attendees: {e}")
                    return jsonify({
                        "reply": [],
                        "message": f"Error finding attendees: {str(e)}"
                    })
                
                if not attendee_ids:
                    return jsonify({
                        "reply": [],
                        "message": f"I couldn't find any employees matching: {attendees}. Please check the names."
                    })
                
                # Insert into announcements table
                try:
                    employees_str = ', '.join(attendee_full_names)
                    message_text = f"Meeting scheduled with {employees_str}"
                    
                    # Convert time format if needed (3pm -> 15:00)
                    formatted_time = meeting_time
                    if 'am' in meeting_time.lower() or 'pm' in meeting_time.lower():
                        try:
                            from datetime import datetime as dt
                            time_obj = dt.strptime(meeting_time.replace(' ', ''), '%I%p')
                            formatted_time = time_obj.strftime('%H:%M')
                        except:
                            formatted_time = meeting_time.replace('am', ':00').replace('pm', ':00')
                    
                    # Use REST API to insert announcement (RPC is read-only)
                    announcement_data = {
                        "title": title,
                        "message": message_text,
                        "event_for": "Employee Event",  # Changed from "meeting" to match UI
                        "employees": attendee_full_names,  # Send as array, not string
                        "event_date": meeting_date,
                        "event_time": formatted_time
                    }
                    
                    url = f"{os.getenv('SUPABASE_URL')}/rest/v1/announcements"
                    headers = {
                        "apikey": os.getenv('SUPABASE_ANON_KEY'),
                        "Authorization": f"Bearer {os.getenv('SUPABASE_ANON_KEY')}",
                        "Content-Type": "application/json",
                        "Prefer": "return=representation"
                    }
                    
                    print(f"[MEETING] Creating announcement: {announcement_data}")
                    resp = requests.post(url, headers=headers, json=announcement_data, timeout=30)
                    print(f"[MEETING] Response: {resp.status_code} - {resp.text[:200] if resp.text else 'OK'}")
                    
                    if resp.status_code in [200, 201]:
                        return jsonify({
                            "action": "schedule_meeting",
                            "reply": {"title": title, "date": meeting_date, "time": formatted_time, "attendees": attendee_full_names},
                            "message": f"✅ **Meeting Scheduled!**\n\n📌 **{title}**\n📅 Date: {meeting_date}\n⏰ Time: {formatted_time}\n👥 Attendees: {', '.join(attendee_full_names)}"
                        })
                    else:
                        print(f"[MEETING ERROR] {resp.text}")
                        return jsonify({
                            "action": "schedule_meeting",
                            "reply": {},
                            "message": f"❌ Failed to schedule meeting: {resp.text}"
                        })
                except Exception as e:
                    print(f"[MEETING ERROR] {e}")
                    return jsonify({
                        "action": "schedule_meeting",
                        "reply": {},
                        "message": f"❌ Failed to schedule meeting. Error: {str(e)}"
                    })
            if action_name in ("assign_task_with_timesheet", "upsert_timesheet", "schedule_meeting_timesheet"):
                # auto-fill requester_id/employee_id for self-timesheet when missing
                if action_name == "upsert_timesheet" and "employee_id" not in params:
                    params["employee_id"] = user_id
                if "requester_id" not in params:
                    params["requester_id"] = user_id
                # normalize for schedule_meeting_timesheet to match p_* signature
                if action_name == "schedule_meeting_timesheet":
                    raw_date = params.get("date")
                    if isinstance(raw_date, str) and "T" in raw_date:
                        raw_date = raw_date.split("T", 1)[0]
                    params = {
                        "p_requester": params.get("requester_id", user_id),
                        "p_team_id": params.get("team_id", team_id),
                        "p_date": raw_date or params.get("date"),
                        "p_hours": params.get("hours", 1),
                    }
                response = supabase.rpc(action_name, params).execute()
                friendly = {"action": action_name, "reply": response.data}
                if action_name == "assign_task_with_timesheet":
                    friendly["message"] = f"✅ Assigned '{params.get('title', 'task')}' to {params.get('assignee_email')}"
                return jsonify(friendly)
            
            # Unknown action - try to handle gracefully
            return jsonify({"reply": [], "message": f"I understood you want to {action_name}, but I'm not sure how to do that yet."})
        except Exception as e:
            print(f"[CHAT] Action error: {e}")
            return jsonify({"error": f"action_parse_failed: {e}", "raw": sql_query})

    # STEP 4 - run SQL on Supabase
    try:
        # Remove trailing semicolon
        clean_sql = sql_query.rstrip(";").strip()
        print(f"[CHAT] SQL: {clean_sql}")
        
        # Validate that this looks like actual SQL
        clean_upper = clean_sql.upper()
        if not (clean_upper.startswith("SELECT") or clean_upper.startswith("INSERT") or 
                clean_upper.startswith("UPDATE") or clean_upper.startswith("DELETE")):
            # Not valid SQL - might be a chat response from LLM
            print(f"[CHAT] Not valid SQL, returning as message: {clean_sql}")
            return jsonify({"reply": [], "message": clean_sql if len(clean_sql) < 500 else "I'm not sure how to help with that. Try asking about tasks, leaves, or meetings."})
        
        response = supabase.rpc("execute_sql_chatbot", {"sql": clean_sql}).execute()
        data = response.data
        
        # ========== OUTPUT SANITIZATION ==========
        # Remove sensitive fields before returning
        data = sanitize_output(data)
        # Log successful request
        log_request(user_id, role, "sql_query", clean_sql[:50], "allowed", 0.0)

        # Friendly empty-state message for common queries
        if isinstance(data, list) and len(data) == 0:
            hint = "No records found."
            low = user_message.lower()
            if "leave" in low:
                hint = "No pending leaves found."
            elif "task" in low:
                hint = "No tasks found."
            elif "timesheet" in low:
                hint = "No timesheets found."
            return jsonify({"sql": clean_sql, "reply": [], "message": hint})

        # Attach human-readable names when IDs are present
        if isinstance(data, list):
            ids = set()
            for row in data:
                if isinstance(row, dict):
                    for field in ("assigned_to", "assigned_by", "employee_id", "reviewer_id"):
                        pid = row.get(field)
                        if pid:
                            ids.add(pid)
            name_map = _fetch_name_map(supabase, ids)
            data = _annotate_with_names(data, name_map)
        
        # FORMAT TASKS - clean structured format
        low = user_message.lower()
        if isinstance(data, list) and len(data) > 0 and ("task" in low or "FROM tasks" in clean_sql):
            if 'title' in data[0]:  # It's a tasks query
                task_lines = []
                for i, task in enumerate(data, 1):
                    title = task.get('title', 'Untitled')
                    status = task.get('status', 'pending') or 'pending'
                    priority = task.get('priority', 'medium') or 'medium'
                    start = task.get('start_date') or 'Not set'
                    due = task.get('due_date') or 'Not set'
                    
                    # Emojis
                    status_emoji = "✅" if status.lower() in ["completed", "done"] else "🔄" if status.lower() == "in_progress" else "⏳"
                    priority_emoji = "🔴 High" if priority == "high" else "🟡 Medium" if priority == "medium" else "🟢 Low"
                    
                    # Card format
                    card = f"""📌 **{i}. {title}**
   • Priority: {priority_emoji}
   • Status: {status_emoji} {status}
   • Start: {start}
   • Due: {due}"""
                    task_lines.append(card)
                
                task_text = "\n\n".join(task_lines[:10])
                return jsonify({
                    "sql": clean_sql, 
                    "reply": data,
                    "message": f"📋 **Your Tasks** ({len(data)} total)\n\n{task_text}"
                })
        
        # Default return for other queries
        return jsonify({"sql": clean_sql, "reply": data})
    except Exception as e:
        print(f"[CHAT] SQL error: {e}")
        return jsonify({"error": str(e), "sql": sql_query})


if __name__ == "__main__":
    print("[SERVER] TalentOps AI Chatbot (Flask)")
    print("[SERVER] Running on http://0.0.0.0:8000")
    app.run(host="0.0.0.0", port=8000, debug=True)
