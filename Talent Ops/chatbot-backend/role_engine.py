"""
Permission rules for each user role.
Manager and executive are full-access; employee and teamlead are scoped.
"""

# Actions we gate in code and prompts. Manager/executive bypass with "all".
ROLE_PERMISSIONS = {
    "employee": {
        "view_profile": True,
        "upload_documents": True,
        "attendance_check_in": True,
        "attendance_check_out": True,
        "view_attendance": True,
        "apply_correction": True,
        "apply_leave": True,
        "edit_own_leave": True,
        "view_leave_status": True,
        "view_leave_balance": True,
        "view_leave_history": True,
        "view_own_tasks": True,
        "add_own_tasks": True,          # create tasks for self
        "edit_own_tasks": True,         # only tasks assigned_to=self and assigned_by=self
        "edit_tasks_assigned_by_others": False,
        "submit_timesheet": True,
        "edit_own_timesheet": True,
        "view_own_timesheet": True,
        "view_payroll_self": True,
        "view_payslip_self": True,
        "submit_reimbursement": True,
        "view_company_announcements": True,
        "view_team_announcements": True,
        "participate_surveys": True,
    },
    "teamlead": {
        "view_team_members": True,
        "view_team_attendance": True,
        "view_team_timesheets": True,
        "view_team_tasks": True,
        "assign_tasks": True,           # can assign to their team
        "edit_team_tasks": True,        # tasks within their team
        "comment_on_tasks": True,
        "approve_timesheets": True,
        "view_team_leaves": True,
        "approve_leaves": False,
        "apply_leave": True,
        "edit_own_leave": True,
        "view_leave_status": True,
        "view_payroll_self": True,
        "view_payslip_self": True,
    },
    "manager": {"all": True},     # everything allowed
    "executive": {"all": True},   # everything allowed
}


def is_allowed(role: str, action: str) -> bool:
    """Return True when the role is permitted for the given action."""
    role = role.lower()
    if role not in ROLE_PERMISSIONS:
        return False
    perms = ROLE_PERMISSIONS[role]
    if perms.get("all"):
        return True
    return perms.get(action, False)
