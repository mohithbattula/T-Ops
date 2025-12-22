# server.py - Full-featured TalentOps AI with READ/WRITE capabilities
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
import json
from dotenv import load_dotenv

from role_engine import is_allowed
from sql_agent import generate_sql, parse_action
from llm_service import call_llm

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "*"])

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}


@app.route("/")
def read_root():
    return jsonify({"message": "TalentOps AI backend is alive!"})


@app.route("/health")
def health_check():
    return jsonify({"status": "ok"})


def execute_sql_via_rpc(sql_query):
    """Execute SELECT SQL via RPC."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/execute_sql_chatbot"
    response = requests.post(url, headers=HEADERS, json={"sql": sql_query}, timeout=30)
    if response.status_code == 200:
        return response.json(), None
    return None, f"Database error: {response.status_code}"


def find_profile_by_name(name):
    """Find a profile by name using SQL search."""
    sql = f"SELECT * FROM profiles WHERE full_name ILIKE '%{name}%' LIMIT 1"
    results, error = execute_sql_via_rpc(sql)
    if results and len(results) > 0:
        print(f"[FIND_PROFILE] Found: {results[0].get('full_name')}")
        return results[0]
    print(f"[FIND_PROFILE] No profile found for '{name}'")
    return None


def create_task(title, description, assignee_id, assignee_name, assigned_by, team_id, priority="medium"):
    """Insert a new task into the database."""
    url = f"{SUPABASE_URL}/rest/v1/tasks"
    task_data = {
        "title": title,
        "description": description or "",
        "status": "pending",
        "priority": priority,
        "assigned_to": assignee_id,
        "assigned_to_name": assignee_name,
        "team_id": team_id
    }
    # Only add assigned_by if it looks like a valid UUID
    if assigned_by and len(str(assigned_by)) > 30 and "-" in str(assigned_by):
        task_data["assigned_by"] = assigned_by
    
    print(f"[CREATE_TASK] Creating: {task_data}")
    response = requests.post(url, headers=HEADERS, json=task_data, timeout=30)
    print(f"[CREATE_TASK] Response: {response.status_code} - {response.text[:200] if response.text else 'OK'}")
    if response.status_code in [200, 201]:
        return response.json(), None
    return None, f"Failed to create task: {response.status_code} - {response.text}"


def approve_leave_by_id(leave_id, status="approved"):
    """Approve or reject a leave by ID."""
    url = f"{SUPABASE_URL}/rest/v1/leaves"
    params = {"id": f"eq.{leave_id}"}
    response = requests.patch(url, headers=HEADERS, params=params, json={"status": status}, timeout=30)
    return response.status_code in [200, 204]


def approve_all_pending_leaves():
    """Approve all pending leaves."""
    url = f"{SUPABASE_URL}/rest/v1/leaves"
    params = {"status": "eq.pending"}
    response = requests.patch(url, headers=HEADERS, params=params, json={"status": "approved"}, timeout=30)
    return response.status_code in [200, 204]


def get_pending_leaves():
    """Get all pending leaves with employee names."""
    url = f"{SUPABASE_URL}/rest/v1/leaves"
    params = {"status": "eq.pending", "select": "*"}
    response = requests.get(url, headers=HEADERS, params=params, timeout=30)
    if response.status_code == 200:
        return response.json()
    return []


def handle_action(action, user_id, role, team_id):
    """Handle action commands (task assignment, leave approval, etc.)."""
    action_type = action.get("action")
    
    # Need more info - ask counter question
    if action_type == "need_info":
        return {
            "message": action.get("question", "I need more information to complete this request."),
            "reply": [],
            "missing_fields": action.get("missing", [])
        }
    
    # Chat/greeting response
    if action_type == "chat":
        return {"message": action.get("response", "Hello! How can I help you?"), "reply": []}
    
    # Assign task
    if action_type == "assign_task":
        title = action.get("title")
        assignee_name = action.get("assignee_name")
        description = action.get("description", "")
        priority = action.get("priority", "medium")
        
        if not title:
            return {"message": "What should the task title be?", "reply": [], "missing_fields": ["title"]}
        if not assignee_name:
            return {"message": "Who should I assign this task to?", "reply": [], "missing_fields": ["assignee_name"]}
        
        # Find the assignee
        profile = find_profile_by_name(assignee_name)
        if not profile:
            return {"message": f"I couldn't find anyone named '{assignee_name}'. Please check the name.", "reply": []}
        
        # Create the task
        result, error = create_task(
            title=title,
            description=description,
            assignee_id=profile["id"],
            assignee_name=profile["full_name"],
            assigned_by=user_id,
            team_id=profile.get("team_id") or team_id,
            priority=priority
        )
        
        if error:
            return {"message": f"Failed to create task: {error}", "reply": []}
        
        return {
            "message": f"✅ Task '{title}' has been assigned to {profile['full_name']}.",
            "reply": result if isinstance(result, list) else [result],
            "action_completed": "task_assigned"
        }
    
    # Approve leaves (with filter)
    if action_type == "approve_leaves":
        if role not in ["manager", "executive"]:
            return {"message": "Only managers and executives can approve leaves.", "reply": "forbidden"}
        
        pending = get_pending_leaves()
        if not pending:
            return {"message": "There are no pending leaves to approve.", "reply": []}
        
        success = approve_all_pending_leaves()
        if success:
            return {
                "message": f"✅ Approved all {len(pending)} pending leave request(s).",
                "reply": pending,
                "action_completed": "leaves_approved"
            }
        return {"message": "Failed to approve leaves.", "reply": []}
    
    # Approve all pending leaves
    if action_type == "approve_all_pending_leaves":
        # Check permission
        if role not in ["manager", "executive"]:
            return {"message": "Only managers and executives can approve leaves.", "reply": [], "reply": "forbidden"}
        
        pending = get_pending_leaves()
        if not pending:
            return {"message": "There are no pending leaves to approve.", "reply": []}
        
        success = approve_all_pending_leaves()
        if success:
            return {
                "message": f"✅ Approved all {len(pending)} pending leave request(s).",
                "reply": pending,
                "action_completed": "leaves_approved"
            }
        return {"message": "Failed to approve leaves. Please try again.", "reply": []}
    
    # Approve specific leave
    if action_type == "approve_leave":
        if role not in ["manager", "executive"]:
            return {"message": "Only managers and executives can approve leaves.", "reply": "forbidden"}
        
        employee_name = action.get("employee_name")
        if not employee_name:
            return {"message": "Whose leave should I approve?", "reply": [], "missing_fields": ["employee_name"]}
        
        # Find the employee
        profile = find_profile_by_name(employee_name)
        if not profile:
            return {"message": f"I couldn't find an employee named '{employee_name}'.", "reply": []}
        
        # Find their pending leave
        url = f"{SUPABASE_URL}/rest/v1/leaves"
        params = {"employee_id": f"eq.{profile['id']}", "status": "eq.pending", "select": "*"}
        response = requests.get(url, headers=HEADERS, params=params, timeout=30)
        
        if response.status_code == 200:
            leaves = response.json()
            if not leaves:
                return {"message": f"{profile['full_name']} doesn't have any pending leave requests.", "reply": []}
            
            # Approve the leave
            for leave in leaves:
                approve_leave_by_id(leave["id"], "approved")
            
            return {
                "message": f"✅ Approved {len(leaves)} leave request(s) for {profile['full_name']}.",
                "reply": leaves,
                "action_completed": "leave_approved"
            }
        
        return {"message": "Failed to find leave requests.", "reply": []}
    
    # Reject leave
    if action_type == "reject_leave":
        if role not in ["manager", "executive"]:
            return {"message": "Only managers and executives can reject leaves.", "reply": "forbidden"}
        
        employee_name = action.get("employee_name")
        if not employee_name:
            return {"message": "Whose leave should I reject?", "reply": [], "missing_fields": ["employee_name"]}
        
        profile = find_profile_by_name(employee_name)
        if not profile:
            return {"message": f"I couldn't find an employee named '{employee_name}'.", "reply": []}
        
        # Find and reject their pending leave
        url = f"{SUPABASE_URL}/rest/v1/leaves"
        params = {"employee_id": f"eq.{profile['id']}", "status": "eq.pending"}
        response = requests.get(url, headers=HEADERS, params=params, timeout=30)
        
        if response.status_code == 200:
            leaves = response.json()
            if not leaves:
                return {"message": f"{profile['full_name']} doesn't have any pending leave requests.", "reply": []}
            
            for leave in leaves:
                approve_leave_by_id(leave["id"], "rejected")
            
            return {
                "message": f"❌ Rejected {len(leaves)} leave request(s) for {profile['full_name']}.",
                "reply": leaves,
                "action_completed": "leave_rejected"
            }
        
        return {"message": "Failed to find leave requests.", "reply": []}
    
    # Unknown action
    return {"message": "I'm not sure how to handle that request.", "reply": []}


def process_query(user_message, role, user_id, team_id):
    """Process user message - generate SQL or action, execute, and respond."""
    
    # Generate SQL or action
    response_str = generate_sql(role, user_id, team_id, user_message)
    
    # Try to parse as action
    action, is_action = parse_action(response_str)
    
    if is_action:
        return handle_action(action, user_id, role, team_id)
    
    # It's a SQL query
    sql_query = response_str.strip()
    
    # Validate SQL
    if not sql_query.upper().startswith("SELECT"):
        return {"message": "I'm not sure how to help with that. Try asking about tasks, employees, teams, or leaves.", "reply": []}
    
    # Remove trailing semicolon
    sql_query = sql_query.rstrip(";").strip()
    
    # Execute SQL
    results, error = execute_sql_via_rpc(sql_query)
    
    if error:
        print(f"[ERROR] SQL: {sql_query} | Error: {error}")
        return {"message": "I couldn't retrieve that data. Please try rephrasing.", "reply": []}
    
    if not results:
        return {"message": "No data found matching your query.", "reply": []}
    
    # Generate natural response
    limited = results[:10]
    prompt = f"""Based on the user's question and the database results, provide a brief, helpful response.

Question: "{user_message}"
Data: {json.dumps(limited, default=str)}
Total records: {len(results)}

Give a concise, natural response using ONLY the data provided:"""

    natural_response = call_llm(prompt)
    
    return {"message": natural_response, "reply": results}


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
    
    try:
        result = process_query(user_message, role, user_id, team_id)
        return jsonify(result)
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)})


if __name__ == "__main__":
    print(f"[SERVER] TalentOps AI Chatbot")
    print(f"[SERVER] Features: Query, Task Assignment, Leave Approval")
    print(f"[SERVER] Supabase: {SUPABASE_URL}")
    print(f"[SERVER] OpenAI: {'✓' if OPENAI_API_KEY else '✗'}")
    app.run(host="0.0.0.0", port=8000, debug=True)
