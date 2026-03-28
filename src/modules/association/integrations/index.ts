import Integration from "../../integrations/integrations/integrations.model";
import ConfigToken from "../../integrations/config_tokens/config_tokens.model";
import Order from "../../sales/orders/orders.model";

// 1. INTEGRATIONS 1:1 CONFIG_TOKENS
Integration.hasOne(ConfigToken, { foreignKey: 'integrations_id', as: 'tokens' });
ConfigToken.belongsTo(Integration, { foreignKey: 'integrations_id', as: 'integration' });

// 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) INTEGRATION SIDE
Integration.hasMany(Order, { foreignKey: 'integration_id', as: 'orders' });

export default {
    Integration,
    ConfigToken
};