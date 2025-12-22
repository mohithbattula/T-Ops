# guardrails.py - Enterprise-Grade AI Safety Controls
# TalentOps Chatbot Security Module
# Philosophy: LLM assists — code decides

import re
import json
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any

# ============================================================
# CONSTANTS
# ============================================================

MAX_INPUT_LENGTH = 500
MAX_OUTPUT_RECORDS = 10

# SQL Injection patterns
SQL_INJECTION_PATTERNS = [
    r";\s*DROP\s+",
    r";\s*DELETE\s+",
    r";\s*TRUNCATE\s+",
    r";\s*UPDATE\s+.*SET\s+",
    r";\s*INSERT\s+",
    r"--\s*$",
    r"\/\*.*\*\/",
    r"'\s*OR\s+'1'\s*=\s*'1",
    r"'\s*OR\s+1\s*=\s*1",
    r"UNION\s+SELECT",
]

# Prompt injection patterns (behavioral)
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(previous|all|your)\s+(instructions?|rules?|prompts?)",
    r"forget\s+(everything|your|all)",
    r"you\s+are\s+now\s+a?",
    r"new\s+rule\s*:",
    r"system\s*:\s*",
    r"override\s+(security|permission|access)",
    r"pretend\s+(you|to\s+be)",
    r"act\s+as\s+(if|a)",
    r"tell\s+me\s+(the|your)\s+(password|secret|key)",
    r"show\s+(all|every|complete)\s+(data|records?|employees?|salaries?)",
    r"debug\s+mode",
    r"test\s+mode",
    r"admin\s+mode",
    r"bypass\s+(security|permission|check)",
]

# Off-topic keywords
OFF_TOPIC_PATTERNS = [
    r"weather\s+(today|tomorrow|forecast)",
    r"what\s+is\s+the\s+(capital|president|population)",
    r"tell\s+me\s+a\s+joke",
    r"who\s+won\s+(the|last)",
    r"recipe\s+for",
    r"how\s+to\s+cook",
    r"movie\s+recommendation",
    r"what\s+do\s+you\s+think\s+about",
    r"political\s+opinion",
    r"stock\s+price",
    r"bitcoin|crypto",
]

# Sensitive fields that should NEVER be exposed
SENSITIVE_FIELDS = [
    'password', 'password_hash', 'auth_token', 'access_token', 'refresh_token',
    'secret', 'api_key', 'private_key', 'ssn', 'social_security', 'aadhaar',
    'bank_account', 'account_number', 'routing_number', 'credit_card', 'cvv',
    'salary', 'compensation', 'pay', 'wage', 'bonus', 'medical', 'health_record',
    'address', 'home_address', 'personal_phone', 'emergency_contact'
]

# Allowed intents/topics for TalentOps
ALLOWED_INTENTS = [
    'view_tasks', 'assign_task', 'create_task', 'update_task',
    'apply_leave', 'check_leave_balance', 'check_leave_status', 'approve_leave', 'reject_leave',
    'view_pending_leaves', 'view_employee_leave_balance',
    'schedule_meeting', 'view_meetings',
    'check_in', 'check_out', 'view_attendance',
    'view_team_tasks', 'view_team_members', 'view_profile',
    'chat', 'greeting', 'help', 'forbidden', 'need_info'
]

# ============================================================
# INPUT VALIDATION (Layer 2)
# ============================================================

def validate_input(query: str) -> Tuple[bool, str]:
    """
    Validate user input for security threats.
    Returns: (is_valid, error_message)
    """
    if not query or not query.strip():
        return False, "Empty input received."
    
    # Check length
    if len(query) > MAX_INPUT_LENGTH:
        log_security_event("input_too_long", {"length": len(query)})
        return False, "Your message is too long. Please keep it under 500 characters."
    
    # Check for SQL injection
    query_lower = query.lower()
    for pattern in SQL_INJECTION_PATTERNS:
        if re.search(pattern, query_lower, re.IGNORECASE):
            log_security_event("sql_injection_attempt", {"pattern": pattern, "query": query[:100]})
            return False, "I can't process that request."
    
    return True, ""


def detect_prompt_injection(query: str) -> Tuple[bool, float]:
    """
    Detect prompt injection attempts using behavioral patterns.
    Returns: (is_injection, risk_score)
    """
    query_lower = query.lower()
    risk_score = 0.0
    detected_patterns = []
    
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, query_lower, re.IGNORECASE):
            risk_score += 0.3
            detected_patterns.append(pattern)
    
    # Additional behavioral signals
    if "all" in query_lower and any(word in query_lower for word in ["show", "display", "get", "list"]):
        risk_score += 0.1
    
    if any(word in query_lower for word in ["entire", "complete", "full", "every"]):
        risk_score += 0.1
    
    if risk_score > 0:
        log_security_event("prompt_injection_detected", {
            "patterns": detected_patterns,
            "risk_score": risk_score,
            "query": query[:100]
        })
    
    is_injection = risk_score >= 0.3
    return is_injection, min(risk_score, 1.0)


def is_on_topic(query: str) -> Tuple[bool, str]:
    """
    Check if query is within allowed scope (HR/workforce topics).
    Returns: (is_on_topic, redirect_message)
    """
    query_lower = query.lower()
    
    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, query_lower, re.IGNORECASE):
            log_security_event("off_topic_query", {"query": query[:100]})
            return False, "I'm TalentOps AI, focused on HR and workforce tasks. I can help with tasks, leaves, meetings, and employee data. What would you like to do?"
    
    return True, ""


# ============================================================
# INTENT → ACTION → RESOURCE GUARDRAIL (Layer 2/3)
# ============================================================

def check_intent_action_resource(
    intent: str,
    user_role: str,
    user_id: str,
    team_id: str,
    target_resource: Optional[Dict] = None
) -> Tuple[bool, str]:
    """
    Three-gate security check:
    1. Intent - Is this a valid intent?
    2. Action - Is this action allowed for this role?
    3. Resource - Is user allowed to act on this specific object?
    
    Returns: (is_allowed, denial_message)
    """
    # Gate 1: Intent Validation
    if intent not in ALLOWED_INTENTS:
        log_security_event("invalid_intent", {"intent": intent, "user_id": user_id})
        return False, "I don't understand that request."
    
    # Gate 2: Action Permission Check
    action_allowed, action_msg = check_role_permission(intent, user_role)
    if not action_allowed:
        log_security_event("action_denied", {
            "intent": intent,
            "role": user_role,
            "user_id": user_id
        })
        return False, action_msg
    
    # Gate 3: Resource Ownership Check (if target resource provided)
    if target_resource:
        resource_allowed, resource_msg = check_resource_ownership(
            intent, user_role, user_id, team_id, target_resource
        )
        if not resource_allowed:
            log_security_event("resource_denied", {
                "intent": intent,
                "user_id": user_id,
                "resource": str(target_resource)[:100]
            })
            return False, resource_msg
    
    return True, ""


def check_role_permission(intent: str, role: str) -> Tuple[bool, str]:
    """
    Check if a role is allowed to perform an action.
    """
    role_lower = role.lower()
    denial_msg = "I'm sorry, you don't have permission to perform this action."
    
    # Define permission matrix
    permissions = {
        # Tasks
        'view_tasks': ['employee', 'team_lead', 'manager', 'executive'],
        'view_team_tasks': ['team_lead', 'manager', 'executive'],
        'assign_task': ['team_lead', 'manager', 'executive'],
        'create_task': ['employee', 'team_lead', 'manager', 'executive'],
        
        # Leaves
        'apply_leave': ['employee', 'team_lead', 'manager', 'executive'],
        'check_leave_balance': ['employee', 'team_lead', 'manager', 'executive'],
        'check_leave_status': ['employee', 'team_lead', 'manager', 'executive'],
        'view_pending_leaves': ['team_lead', 'manager', 'executive'],
        'view_employee_leave_balance': ['team_lead', 'manager', 'executive'],
        'approve_leave': ['team_lead', 'manager', 'executive'],
        'reject_leave': ['team_lead', 'manager', 'executive'],
        
        # Meetings
        'schedule_meeting': ['team_lead', 'manager', 'executive'],
        'view_meetings': ['employee', 'team_lead', 'manager', 'executive'],
        
        # Attendance
        'check_in': ['employee', 'team_lead', 'manager', 'executive'],
        'check_out': ['employee', 'team_lead', 'manager', 'executive'],
        'view_attendance': ['employee', 'team_lead', 'manager', 'executive'],
        
        # Team/Profile
        'view_team_members': ['team_lead', 'manager', 'executive'],
        'view_profile': ['employee', 'team_lead', 'manager', 'executive'],
        
        # General
        'chat': ['employee', 'team_lead', 'manager', 'executive'],
        'greeting': ['employee', 'team_lead', 'manager', 'executive'],
        'help': ['employee', 'team_lead', 'manager', 'executive'],
        'forbidden': ['employee', 'team_lead', 'manager', 'executive'],
        'need_info': ['employee', 'team_lead', 'manager', 'executive'],
    }
    
    allowed_roles = permissions.get(intent, [])
    if role_lower in allowed_roles:
        return True, ""
    
    return False, denial_msg


def check_resource_ownership(
    intent: str,
    role: str,
    user_id: str,
    user_team_id: str,
    resource: Dict
) -> Tuple[bool, str]:
    """
    Check if user has ownership/management rights over the resource.
    """
    role_lower = role.lower()
    denial_msg = "I'm sorry, you don't have permission to access this data."
    
    # Executives can access everything (except sensitive data - handled separately)
    if role_lower == 'executive':
        return True, ""
    
    # Get resource ownership info
    resource_owner_id = resource.get('employee_id') or resource.get('created_by') or resource.get('requested_by')
    resource_team_id = resource.get('team_id')
    
    # Self-action prevention for approvals
    if intent in ['approve_leave', 'reject_leave']:
        if resource_owner_id == user_id:
            return False, "You cannot approve or reject your own leave request."
    
    # Team Lead/Manager can only access their team's resources
    if role_lower in ['team_lead', 'manager']:
        # If viewing someone else's data
        if resource_owner_id and resource_owner_id != user_id:
            # Must be in same team
            if resource_team_id and resource_team_id != user_team_id:
                return False, "You can only access data for employees in your team."
    
    # Employee can only access their own resources
    if role_lower == 'employee':
        if resource_owner_id and resource_owner_id != user_id:
            return False, denial_msg
    
    return True, ""


# ============================================================
# OUTPUT SANITIZATION (Layer 3)
# ============================================================

def sanitize_output(data: Any) -> Any:
    """
    Remove sensitive fields from output data.
    Limit number of records returned.
    """
    if data is None:
        return data
    
    if isinstance(data, list):
        # Limit records
        limited_data = data[:MAX_OUTPUT_RECORDS]
        return [sanitize_single_record(record) for record in limited_data]
    
    if isinstance(data, dict):
        return sanitize_single_record(data)
    
    return data


def sanitize_single_record(record: Dict) -> Dict:
    """
    Remove sensitive fields from a single record.
    """
    if not isinstance(record, dict):
        return record
    
    sanitized = {}
    for key, value in record.items():
        # Skip sensitive fields
        key_lower = key.lower()
        if any(sensitive in key_lower for sensitive in SENSITIVE_FIELDS):
            continue
        
        # Recursively sanitize nested dicts
        if isinstance(value, dict):
            sanitized[key] = sanitize_single_record(value)
        elif isinstance(value, list):
            sanitized[key] = [sanitize_single_record(item) if isinstance(item, dict) else item for item in value]
        else:
            sanitized[key] = value
    
    return sanitized


# ============================================================
# FAIL-CLOSED GUARDRAIL
# ============================================================

def fail_closed_check(user_id: str, user_role: str, team_id: str) -> Tuple[bool, str]:
    """
    Deny if essential identity information is missing.
    Never guess - always fail closed.
    """
    if not user_id or len(str(user_id)) < 10:
        log_security_event("fail_closed", {"reason": "missing_user_id"})
        return False, "I couldn't verify your identity. Please log in again."
    
    if not user_role or user_role.lower() not in ['employee', 'team_lead', 'manager', 'executive']:
        log_security_event("fail_closed", {"reason": "invalid_role", "role": user_role})
        return False, "I couldn't verify your permissions. Please contact support."
    
    # team_id can be optional for executives
    if not team_id and user_role.lower() not in ['executive']:
        log_security_event("fail_closed", {"reason": "missing_team_id", "role": user_role})
        return False, "I couldn't determine your team. Please contact support."
    
    return True, ""


# ============================================================
# RISK SCORING
# ============================================================

def calculate_risk_score(
    query: str,
    denial_count: int = 0,
    session_requests: int = 0
) -> float:
    """
    Calculate overall risk score for a request.
    """
    risk_score = 0.0
    
    # Prompt injection check
    _, injection_score = detect_prompt_injection(query)
    risk_score += injection_score
    
    # Previous denial count increases risk
    if denial_count >= 3:
        risk_score += 0.3
    elif denial_count >= 1:
        risk_score += 0.1
    
    # High request volume
    if session_requests > 50:
        risk_score += 0.2
    
    return min(risk_score, 1.0)


# ============================================================
# AUDIT LOGGING
# ============================================================

def log_security_event(event_type: str, details: Dict) -> None:
    """
    Log security events for audit purposes.
    """
    log_entry = {
        "event_type": event_type,
        "timestamp": datetime.now().isoformat(),
        "details": details
    }
    # In production, this would write to a secure log
    print(f"[SECURITY] {json.dumps(log_entry)}")


def log_request(
    user_id: str,
    role: str,
    intent: str,
    target_resource: str,
    decision: str,
    risk_score: float
) -> None:
    """
    Log every request for compliance and auditing.
    """
    log_entry = {
        "user_id": user_id[:8] + "..." if user_id and len(user_id) > 8 else user_id,  # Truncate for privacy
        "role": role,
        "intent": intent,
        "target_resource": target_resource[:50] if target_resource else None,
        "decision": decision,
        "risk_score": risk_score,
        "timestamp": datetime.now().isoformat()
    }
    print(f"[AUDIT] {json.dumps(log_entry)}")


# ============================================================
# MASTER VALIDATION FUNCTION
# ============================================================

def validate_request(
    query: str,
    user_id: str,
    user_role: str,
    team_id: str,
    intent: Optional[str] = None,
    target_resource: Optional[Dict] = None
) -> Tuple[bool, str, float]:
    """
    Master validation function that runs all guardrails.
    
    Returns: (is_allowed, message, risk_score)
    """
    # 1. Fail-closed check
    valid, msg = fail_closed_check(user_id, user_role, team_id)
    if not valid:
        return False, msg, 1.0
    
    # 2. Input validation
    valid, msg = validate_input(query)
    if not valid:
        return False, msg, 0.8
    
    # 3. Prompt injection detection
    is_injection, risk_score = detect_prompt_injection(query)
    if is_injection and risk_score >= 0.5:
        return False, "I can't process that request.", risk_score
    
    # 4. Topic validation
    on_topic, redirect_msg = is_on_topic(query)
    if not on_topic:
        return False, redirect_msg, 0.3
    
    # 5. Intent-Action-Resource check (if intent provided)
    if intent:
        allowed, denial_msg = check_intent_action_resource(
            intent, user_role, user_id, team_id, target_resource
        )
        if not allowed:
            return False, denial_msg, 0.5
    
    return True, "", risk_score


# ============================================================
# CLARIFICATION GUARDRAIL
# ============================================================

def needs_clarification(query: str, role: str) -> Tuple[bool, str]:
    """
    Check if query is ambiguous and needs clarification.
    """
    query_lower = query.lower()
    
    # Ambiguous "all" or "everyone" queries
    if role.lower() not in ['executive']:
        if 'all tasks' in query_lower or 'everyone' in query_lower:
            return True, "Do you want to see your tasks or your team's tasks?"
        if 'all leaves' in query_lower:
            return True, "Do you want to see your leave requests or pending approvals?"
    
    return False, ""
