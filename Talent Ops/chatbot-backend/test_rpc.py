import os
from dotenv import load_dotenv
load_dotenv()
from supabase import create_client

client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
try:
    resp = client.rpc("execute_sql_chatbot", {"sql": "SELECT 1 as test"}).execute()
    print("Success:", resp.data)
except Exception as e:
    print("Error:", e)
