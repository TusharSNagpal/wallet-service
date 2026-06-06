CREATE TABLE IF NOT EXISTS transactions (
  id         CHAR(36)                PRIMARY KEY,
  wallet_id  CHAR(36)                NOT NULL,
  payment_id CHAR(36)                NOT NULL UNIQUE,
  type       ENUM('credit', 'debit') NOT NULL,
  amount     BIGINT                  NOT NULL,
  created_at DATETIME                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME                NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_id ON transactions(wallet_id);
