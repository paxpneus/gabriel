import Integration from "../../integrations/integrations/integrations.model";
import ConfigToken from "../../integrations/config_tokens/config_tokens.model";
import Order from "../../sales/orders/orders.model";
import Customer from "../../sales/customers/customers.model";
import OrderHistory from "../../sales/order_history/order_history.model";
import Step from "../../sales/steps/steps.model";


// 2. INTEGRATIONS 1:N ORDERS (PEDIDOS) ORDER SIDE

Order.belongsTo(Integration, { foreignKey: 'integration_id', as: 'integration' });

// 3. CUSTOMER (CLIENTE) 1:N ORDERS (PEDIDOS)
Customer.hasMany(Order, { foreignKey: 'customer_id', as: 'orders' });
Order.belongsTo(Customer, { foreignKey: 'customer_id', as: 'customer' });

// 4. ORDER (PEDIDO) 1:N ORDER_HISTORY (HISTORICO)
Order.hasMany(OrderHistory, { foreignKey: 'order_id', as: 'history' });
OrderHistory.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });

// 5. STEP N:N ORDER (Via OrderHistory como tabela pivot)
// Isso permite saber todos os passos que um pedido já passou
Order.belongsToMany(Step, { 
    through: OrderHistory, 
    foreignKey: 'order_id', 
    otherKey: 'step_id',
    as: 'steps' 
});

Step.belongsToMany(Order, { 
    through: OrderHistory, 
    foreignKey: 'step_id', 
    otherKey: 'order_id',
    as: 'orders' 
});

// Relacionamento direto do Histórico com o Step (N:1)
OrderHistory.belongsTo(Step, { foreignKey: 'step_id', as: 'step' });
Step.hasMany(OrderHistory, { foreignKey: 'step_id', as: 'histories' });

export default {
    Customer,
    Order,
    OrderHistory,
    Step
};