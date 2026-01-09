-- ============================================
-- Task Status Synchronization Migration
-- ============================================
-- This script synchronizes the 'status' and 'sub_state' columns
-- in the tasks table to ensure consistency when tasks are put on hold.
--
-- Run this in Supabase SQL Editor
-- ============================================

-- STEP 1: Update existing data
-- Update all tasks with status 'on_hold' to also have sub_state 'on_hold'
UPDATE tasks
SET sub_state = 'on_hold'
WHERE status = 'on_hold';

-- STEP 2: Verify the update
SELECT id, title, status, sub_state, updated_at
FROM tasks 
WHERE status = 'on_hold'
ORDER BY updated_at DESC;

-- STEP 3: Create synchronization function
-- This function automatically syncs status and sub_state
CREATE OR REPLACE FUNCTION sync_task_status()
RETURNS TRIGGER AS $$
BEGIN
  -- When status changes to 'on_hold', update sub_state
  IF NEW.status = 'on_hold' THEN
    NEW.sub_state := 'on_hold';
    RAISE NOTICE 'Task % status changed to on_hold, sub_state synced', NEW.id;
  END IF;
  
  -- When status changes from 'on_hold' back to active, restore sub_state
  IF OLD.status = 'on_hold' AND NEW.status != 'on_hold' THEN
    -- Set sub_state to 'in_progress' when resuming from hold
    NEW.sub_state := 'in_progress';
    RAISE NOTICE 'Task % resumed from on_hold, sub_state set to in_progress', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 4: Drop existing trigger if it exists
DROP TRIGGER IF EXISTS sync_task_status_trigger ON tasks;

-- STEP 5: Create the trigger
CREATE TRIGGER sync_task_status_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_task_status();

-- STEP 6: Test the trigger
-- This should automatically set sub_state to 'on_hold'
-- Uncomment and replace <task_id> with an actual task ID to test:
-- UPDATE tasks SET status = 'on_hold' WHERE id = '<task_id>';
-- SELECT id, title, status, sub_state FROM tasks WHERE id = '<task_id>';

-- STEP 7: Verify trigger exists
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_name = 'sync_task_status_trigger';

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================
-- Uncomment the following lines to remove the trigger:
--
-- DROP TRIGGER IF EXISTS sync_task_status_trigger ON tasks;
-- DROP FUNCTION IF EXISTS sync_task_status();
--
-- To restore sub_state to previous values:
-- UPDATE tasks
-- SET sub_state = 'in_progress'
-- WHERE status = 'in_progress' AND sub_state = 'on_hold';
-- ============================================

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Task status synchronization migration completed successfully!';
  RAISE NOTICE '✅ Trigger created: sync_task_status_trigger';
  RAISE NOTICE '✅ All tasks with status=on_hold now have sub_state=on_hold';
END $$;
