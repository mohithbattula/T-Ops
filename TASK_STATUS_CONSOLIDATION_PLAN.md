# Task Status Synchronization Implementation Plan

## Problem
Currently, the `tasks` table has two status fields:
- `status`: Can be 'pending', 'in_progress', 'on_hold', 'completed'
- `sub_state`: Can be 'in_progress', 'pending_validation', 'approved', 'rejected'

When a task is put "on hold", only `status` is updated to 'on_hold', but `sub_state` remains 'in_progress', causing confusion in the UI.

## Solution
Synchronize both fields so when `status` = 'on_hold', `sub_state` also becomes 'on_hold'.

---

## Step 1: Database Migration (SQL)

### 1.1 Update Existing Data
Run this in Supabase SQL Editor:

```sql
-- Update all existing tasks with status 'on_hold' to also have sub_state 'on_hold'
UPDATE tasks
SET sub_state = 'on_hold'
WHERE status = 'on_hold';

-- Verify the update
SELECT id, title, status, sub_state 
FROM tasks 
WHERE status = 'on_hold';
```

### 1.2 Create Database Trigger (Automatic Sync)
This ensures future updates are automatically synchronized:

```sql
-- Create a function to sync status and sub_state
CREATE OR REPLACE FUNCTION sync_task_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes to 'on_hold', update sub_state
  IF NEW.status = 'on_hold' THEN
    NEW.sub_state := 'on_hold';
  END IF;
  
  -- When status changes from 'on_hold' back to active, restore sub_state
  IF OLD.status = 'on_hold' AND NEW.status != 'on_hold' THEN
    -- Set sub_state to 'in_progress' when resuming from hold
    NEW.sub_state := 'in_progress';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS sync_task_status_trigger ON tasks;

-- Create the trigger
CREATE TRIGGER sync_task_status_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION sync_task_status();
```

---

## Step 2: Frontend Updates

### 2.1 Update Task Status Change Functions

Wherever you update task status to 'on_hold', also update sub_state:

**Before:**
```javascript
await supabase
  .from('tasks')
  .update({ status: 'on_hold' })
  .eq('id', taskId);
```

**After:**
```javascript
await supabase
  .from('tasks')
  .update({ 
    status: 'on_hold',
    sub_state: 'on_hold'  // Add this
  })
  .eq('id', taskId);
```

### 2.2 Update Task Resume Functions

When resuming a task from 'on_hold':

**Before:**
```javascript
await supabase
  .from('tasks')
  .update({ status: 'in_progress' })
  .eq('id', taskId);
```

**After:**
```javascript
await supabase
  .from('tasks')
  .update({ 
    status: 'in_progress',
    sub_state: 'in_progress'  // Add this
  })
  .eq('id', taskId);
```

### 2.3 Update UI Display Logic

In `MyTasksPage.jsx` and other task display components, update the badge logic:

**Current (lines 934-941):**
```javascript
<span style={{
    fontSize: '0.75rem', padding: '4px 10px', borderRadius: '20px',
    backgroundColor: getSubStateColor(taskForView.sub_state).bg,
    color: getSubStateColor(taskForView.sub_state).text, fontWeight: 600,
    textTransform: 'capitalize'
}}>
    {taskForView.sub_state?.replace(/_/g, ' ') || 'Pending'}
</span>
```

**Updated:**
```javascript
<span style={{
    fontSize: '0.75rem', padding: '4px 10px', borderRadius: '20px',
    backgroundColor: getSubStateColor(taskForView.sub_state).bg,
    color: getSubStateColor(taskForView.sub_state).text, fontWeight: 600,
    textTransform: 'capitalize'
}}>
    {/* Show 'On Hold' if status is on_hold, otherwise show sub_state */}
    {taskForView.status === 'on_hold' ? 'On Hold' : (taskForView.sub_state?.replace(/_/g, ' ') || 'Pending')}
</span>
```

### 2.4 Update getSubStateColor Function

Add 'on_hold' case to the color function:

```javascript
const getSubStateColor = (subState) => {
    switch (subState) {
        case 'in_progress': return { bg: '#dbeafe', text: '#1d4ed8' };
        case 'pending_validation': return { bg: '#fef3c7', text: '#b45309' };
        case 'approved': return { bg: '#dcfce7', text: '#166534' };
        case 'rejected': return { bg: '#fee2e2', text: '#991b1b' };
        case 'on_hold': return { bg: '#fee2e2', text: '#991b1b' };  // Add this
        default: return { bg: '#f3f4f6', text: '#6b7280' };
    }
};
```

---

## Step 3: Files to Update

### Priority Files (Where task status is updated):
1. `components/shared/AllTasksView.jsx` - Task management
2. `components/shared/ManagerTaskDashboard.jsx` - Manager task actions
3. `components/manager/components/Tasks/ManagerTasks.jsx` - Manager task updates
4. `components/teamlead/components/TeamTasks.jsx` - Team lead task updates
5. `components/employee/pages/MyTasksPage.jsx` - Employee task view

### Search for these patterns:
```javascript
// Pattern 1: Direct status update
.update({ status: 'on_hold' })

// Pattern 2: Status in object
.update({ ...taskData, status: 'on_hold' })

// Pattern 3: In form submissions
status: 'on_hold'
```

---

## Step 4: Testing Checklist

- [ ] Run SQL migration to update existing data
- [ ] Create database trigger
- [ ] Test putting a task on hold (both status and sub_state should be 'on_hold')
- [ ] Test resuming a task from hold (both should return to 'in_progress')
- [ ] Verify UI shows only one "On Hold" badge
- [ ] Test across all roles (Executive, Manager, Team Lead, Employee)
- [ ] Verify real-time updates work correctly

---

## Step 5: Rollback Plan (If Needed)

If something goes wrong:

```sql
-- Remove the trigger
DROP TRIGGER IF EXISTS sync_task_status_trigger ON tasks;
DROP FUNCTION IF EXISTS sync_task_status();

-- Restore sub_state to previous values (if you have a backup)
-- Or manually fix specific tasks
UPDATE tasks
SET sub_state = 'in_progress'
WHERE status = 'in_progress' AND sub_state = 'on_hold';
```

---

## Notes
- The database trigger ensures backend consistency
- Frontend updates ensure immediate UI feedback
- Both approaches work together for a robust solution
- The trigger handles edge cases where status is updated directly in the database
