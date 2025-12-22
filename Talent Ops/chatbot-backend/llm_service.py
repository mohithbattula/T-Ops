# llm_service.py - Python 3.14 compatible using requests

import os
from dotenv import load_dotenv
import requests

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MODEL_NAME = "gpt-4o-mini"   # fast + cheap + great for SQL


def call_llm(prompt: str) -> str:
    """
    Sends a prompt to OpenAI ChatGPT API and returns the response.
    Uses requests directly instead of the openai package for Python 3.14 compatibility.
    """
    if not OPENAI_API_KEY:
        return "Error: OPENAI_API_KEY is not set in .env"
    
    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": MODEL_NAME,
                "messages": [
                    {"role": "system", "content": "You are a backend AI that generates SQL and explains results."},
                    {"role": "user", "content": prompt}
                ]
            },
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()

    except requests.exceptions.HTTPError as http_err:
        print(f"[LLM] HTTP error: {http_err}")
        print(f"[LLM] Response: {http_err.response.text if http_err.response else 'No response'}")
        return f"LLM API error: {http_err}"
    except Exception as e:
        print(f"[LLM] General error: {e}")
        return "Sorry, I could not process that."
