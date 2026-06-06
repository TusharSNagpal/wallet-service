import { DataTypes, Model } from 'sequelize';
import sequelize from '../../database';

type TransactionType = 'credit' | 'debit';

class Transaction extends Model {
  declare id: string;
  declare walletId: string;
  declare paymentId: string;
  declare type: TransactionType;
  declare amount: number;
  declare created_at: Date;
  declare updated_at: Date;
}

Transaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    walletId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    paymentId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    type: {
      type: DataTypes.ENUM('credit', 'debit'),
      allowNull: false,
    },
    amount: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'transactions',
    timestamps: true,
    underscored: true,
  }
);

export default Transaction;
