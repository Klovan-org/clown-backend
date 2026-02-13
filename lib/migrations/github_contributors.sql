CREATE TABLE IF NOT EXISTS github_contributors (
  id SERIAL PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  github_username VARCHAR(255) NOT NULL,
  github_avatar_url TEXT,
  github_email VARCHAR(255),
  invite_status VARCHAR(20) DEFAULT 'pending',
  invited_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_status ON github_contributors(invite_status);
CREATE INDEX IF NOT EXISTS idx_github_username ON github_contributors(github_username);
