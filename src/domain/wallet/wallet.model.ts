import { DataTypes, Model } from 'sequelize';
import sequelize from '../../database';

class Wallet extends Model {
  declare id: string;
  declare userId: string;
  declare balance: number;
  declare created_at: Date;
  declare updated_at: Date;
}

Wallet.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    balance: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'wallets',
    timestamps: true,
    underscored: true,
  }
);

export default Wallet;
