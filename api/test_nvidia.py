#!/usr/bin/env python3
"""Test script to verify NVIDIA API access"""

import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(".env")
load_dotenv(".env.local")

nvidia_api_key = os.getenv("NVIDIA_API_KEY")
if not nvidia_api_key:
    print("ERROR: NVIDIA_API_KEY not found")
    exit(1)

client = OpenAI(
    api_key=nvidia_api_key,
    base_url="https://integrate.api.nvidia.com/v1"
)

print(f"Testing with API key: {nvidia_api_key[:10]}...")

# Test 1: Try basic completion without reasoning
print("\n=== Test 1: Basic completion ===")
try:
    response = client.chat.completions.create(
        model="nvidia/nvidia-nemotron-nano-9b-v2",
        messages=[{"role": "user", "content": "Say hello"}],
        max_tokens=50
    )
    print(f"✓ Success: {response.choices[0].message.content}")
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 2: Try with reasoning parameters
print("\n=== Test 2: With reasoning parameters ===")
try:
    response = client.chat.completions.create(
        model="nvidia/nvidia-nemotron-nano-9b-v2",
        messages=[{"role": "user", "content": "Say hello"}],
        max_tokens=50,
        extra_body={
            "min_thinking_tokens": 1024,
            "max_thinking_tokens": 2048
        }
    )
    print(f"✓ Success: {response.choices[0].message.content}")
except Exception as e:
    print(f"✗ Failed: {e}")

# Test 3: Try alternative model
print("\n=== Test 3: Alternative model (Llama 3.1) ===")
try:
    response = client.chat.completions.create(
        model="meta/llama-3.1-8b-instruct",
        messages=[{"role": "user", "content": "Say hello"}],
        max_tokens=50
    )
    print(f"✓ Success: {response.choices[0].message.content}")
except Exception as e:
    print(f"✗ Failed: {e}")
