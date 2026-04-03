import Integration from "../../integrations/integrations/integrations.model";
import ConfigToken from "../../integrations/config_tokens/config_tokens.model";
import Order from "../../sales/orders/order/orders.model";
import Customer from "../../sales/customers/customers.model";
import OrderHistory from "../../sales/orders/order_history/order_history.model";
import Step from "../../sales/steps/steps.model";
import OrderItems from "../../sales/orders/order_items/order_items.model";
import Store from "../../sales/stores/stores.model";

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

// OrderItems N:1 Orders (Itens do pedido e pedido)
OrderItems.belongsTo(Order, { foreignKey: 'order_id', as: 'order' });
Order.hasMany(OrderItems, { foreignKey: 'order_id', as: 'items' })

// Store 1:N Orders (loja e pedido)
Order.belongsTo(Store, { foreignKey: 'store_id', as: 'store' });
Store.hasMany(Order, { foreignKey: 'store_id', as: 'orders' })

export default {
    Customer,
    Order,
    OrderItems,
    OrderHistory,
    Step,
    Store
};