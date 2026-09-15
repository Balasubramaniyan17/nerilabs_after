"""
Configuration settings for the Multi-Tenant Autonomous Experimentation Platform.
"""

import os

class Config:
    # Networking & Domain
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "")
    MARKETING_URL: str = os.getenv("MARKETING_URL", "")
    
    # Persistence
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "/data/nerilabs_saas_platform.db")

    # Security & Cryptography
    JWT_SECRET: str = os.getenv("JWT_SECRET", "super-secure-hmac-sha256-secret-key-nerilabs-2026")
    JWT_ALGORITHM: str = "HS256"
    TOKEN_EXPIRATION_SECONDS: int = int(os.getenv("TOKEN_EXPIRATION_SECONDS", 3600))
    
    # LLM & Agent Configurations
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", None)
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", None)
    DEFAULT_LLM_MODEL: str = os.getenv("DEFAULT_LLM_MODEL", "gpt-4o")
    LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.7"))
    
    # Multi-Armed Bandit Defaults
    MAB_DEFAULT_EXPLORATION_FLOOR: float = 0.10  # 10% minimum exploration floor
    MAB_MIN_SAMPLE_THRESHOLD: int = 30           # Minimum sample before declaring confident winner
    MAB_TEMPORAL_DECAY_FACTOR: float = 0.999     # Decay factor for non-stationary environments
    
    # Client SDK Constraints
    CLIENT_TIMEOUT_MS: int = 150                 # 150ms anti-flicker blocking timeout
    
    # Telemetry Beacon Defaults
    BEACON_BATCH_INTERVAL_MS: int = 2000
    
    # Stripe Billing Defaults
    STRIPE_API_KEY: str = os.getenv("STRIPE_API_KEY", "sk_test_mock_stripe_key_12345")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_mock_stripe_secret_67890")
    
    # Autonomous Anomaly Engine
    ANOMALY_SCAN_WINDOW_HOURS: int = 24
    ANOMALY_Z_SCORE_THRESHOLD: float = 2.0
