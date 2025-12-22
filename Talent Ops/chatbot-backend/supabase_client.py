# supabase_client.py - Python 3.14 compatible using requests

import os
from dotenv import load_dotenv
import requests

load_dotenv()

_supabase_url = os.getenv("SUPABASE_URL")
_supabase_key = os.getenv("SUPABASE_ANON_KEY")

if not _supabase_url or not _supabase_key:
    raise ValueError("SUPABASE_URL or SUPABASE_ANON_KEY is missing in .env")


class SupabaseClient:
    """Minimal Supabase client for Python 3.14 compatibility using requests."""
    
    def __init__(self, url: str, key: str):
        self.url = url.rstrip('/')
        self.key = key
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
    
    def table(self, name: str):
        return TableQuery(self, name)
    
    def rpc(self, function_name: str, params: dict = None):
        return RPCQuery(self, function_name, params or {})


class TableQuery:
    def __init__(self, client, table_name: str):
        self.client = client
        self.table_name = table_name
        self._select_cols = "*"
        self._filters = []
    
    def select(self, columns: str = "*"):
        self._select_cols = columns
        return self
    
    def in_(self, column: str, values: list):
        values_str = ",".join(f'"{v}"' if isinstance(v, str) else str(v) for v in values)
        self._filters.append(f"{column}=in.({values_str})")
        return self
    
    def eq(self, column: str, value):
        self._filters.append(f"{column}=eq.{value}")
        return self
    
    def execute(self):
        url = f"{self.client.url}/rest/v1/{self.table_name}"
        params = {"select": self._select_cols}
        
        query_parts = "&".join(self._filters)
        if query_parts:
            url = f"{url}?{query_parts}"
        
        response = requests.get(url, headers=self.client.headers, params=params, timeout=30)
        response.raise_for_status()
        
        class Response:
            def __init__(self, data):
                self.data = data
        
        return Response(response.json())


class RPCQuery:
    def __init__(self, client, function_name: str, params: dict):
        self.client = client
        self.function_name = function_name
        self.params = params
    
    def execute(self):
        url = f"{self.client.url}/rest/v1/rpc/{self.function_name}"
        
        response = requests.post(url, headers=self.client.headers, json=self.params, timeout=30)
        response.raise_for_status()
        
        class Response:
            def __init__(self, data):
                self.data = data
        
        return Response(response.json())


_supabase = SupabaseClient(_supabase_url, _supabase_key)


def get_client():
    return _supabase
