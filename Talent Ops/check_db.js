
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase (using values from your .env or similar if available, or just mocking for structure check if possible. 
// Actually I need to run this in the existing project context or use a special tool? 
// I'll create a temporary .js file that imports from lib/supabaseClient and runs a query.)

import { supabase } from './lib/supabaseClient.js';

const checkColumn = async () => {
    console.log('Checking conversation_members columns...');
    const { data, error } = await supabase
        .from('conversation_members')
        .select('last_read_at')
        .limit(1);

    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('Success! Column exists.');
    }
};

checkColumn();
