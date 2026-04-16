'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const transaction = await queryInterface.sequelize.transaction();
        try {

            await queryInterface.renameColumn('orders', 'integration_id', 'integrations_id', { transaction })
            // Create ROLES table
            await queryInterface.createTable(
                'roles',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    name: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                        unique: true,
                    },
                    permissions: {
                        type: Sequelize.JSON,
                        allowNull: false,
                        defaultValue: [],
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create UNIT_BUSINESSES table
            await queryInterface.createTable(
                'unit_businesses',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    number: {
                        type: Sequelize.STRING(50),
                        allowNull: false,
                        unique: true,
                    },
                    name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    cnpj: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                        unique: true,
                    },
                    integrations_id: {
                        type: Sequelize.UUID,
                        references: {
                            model: 'integrations',
                            key: 'id'
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                    },
                    head_office: {
                        type: Sequelize.BOOLEAN,
                        defaultValue: false,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create TRANSPORTERS table
            await queryInterface.createTable(
                'transporters',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    cnpj: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                        unique: true,
                    },
                    city: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                    },
                    uf: {
                        type: Sequelize.STRING(2),
                        allowNull: false,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create USERS table
            await queryInterface.createTable(
                'users',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    cpf: {
                        type: Sequelize.STRING(11),
                        allowNull: false,
                        unique: true,
                    },
                    email: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                        unique: true,
                    },
                    password: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    unit_business_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'unit_businesses',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    role_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'roles',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create PRODUCTS table
            await queryInterface.createTable(
                'products',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    sku: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                        unique: true,
                    },
                    ean: {
                        type: Sequelize.STRING(13),
                        allowNull: false,
                        unique: true,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create PRODUCT_SUPPLIER_MAPS table
            await queryInterface.createTable(
                'product_supplier_maps',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    product_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'products',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    supplier_cnpj: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                    },
                    supplier_product_code: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Add unique index
            await queryInterface.addConstraint('product_supplier_maps', {
                fields: ['product_id', 'supplier_cnpj'],
                type: 'unique',
                name: 'product_supplier_maps_product_id_supplier_cnpj_unique',
                transaction,
            });

            // Create STOCKS table
            await queryInterface.createTable(
                'stocks',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    unit_business_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'unit_businesses',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    product_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'products',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    quantity: {
                        type: Sequelize.INTEGER,
                        defaultValue: 0,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Add unique index for stocks
            await queryInterface.addConstraint('stocks', {
                fields: ['unit_business_id', 'product_id'],
                type: 'unique',
                name: 'stocks_unit_business_id_product_id_unique',
                transaction,
            });

            // Create INVOICES table
            await queryInterface.createTable(
                'invoices',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    customer_name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    customer_document: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                    },
                    key: {
                        type: Sequelize.STRING(44),
                        allowNull: false,
                        unique: true,
                    },
                    xml_path: {
                        type: Sequelize.TEXT,
                    },
                    unit_business_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'unit_businesses',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    sender_cnpj: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                    },
                    sender_name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    receiver_cnpj: {
                        type: Sequelize.STRING(14),
                        allowNull: false,
                    },
                    receiver_name: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    transporter_id: {
                        type: Sequelize.UUID,
                        references: {
                            model: 'transporters',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                    },
                    integrations_id: {
                        type: Sequelize.UUID,
                        references: {
                            model: 'integrations',
                            key: 'id'
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                    },
                    id_system: {
                        type: Sequelize.STRING(100),
                    },
                    type: {
                        type: Sequelize.ENUM('INCOMING', 'OUTGOING'),
                        allowNull: false,
                    },
                    status: {
                        type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED'),
                        defaultValue: 'PENDING',
                        allowNull: false,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create INVOICE_ITEMS table
            await queryInterface.createTable(
                'invoice_items',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    product_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'products',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    invoice_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'invoices',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    quantity_expected: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                    },
                    quantity_received: {
                        type: Sequelize.INTEGER,
                        defaultValue: 0,
                    },
                    status: {
                        type: Sequelize.ENUM('PENDING', 'FINISHED'),
                        defaultValue: 'PENDING',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create ENTRANCE_SCAN_LOGS table
            await queryInterface.createTable(
                'entrance_scan_logs',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    invoice_items_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'invoice_items',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    label_full_code: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    vol_number: {
                        type: Sequelize.STRING(6),
                        allowNull: false,
                    },
                    user_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'users',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create EXPEDITION_BATCHES table
            await queryInterface.createTable(
                'expedition_batches',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    number: {
                        type: Sequelize.STRING(50),
                        allowNull: false,
                        unique: true,
                    },
                    status: {
                        type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED'),
                        defaultValue: 'OPEN',
                    },
                    integrations_id: {
                        type: Sequelize.UUID,
                        references: {
                            model: 'integrations',
                            key: 'id'
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                    },
                    id_system: {
                        type: Sequelize.STRING(100),
                    },
                    unit_business_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'unit_businesses',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    total_volumes: {
                        type: Sequelize.INTEGER,
                        defaultValue: 0,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create EXPEDITION_BATCH_ITEMS table
            await queryInterface.createTable(
                'expedition_batch_items',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    expedition_batch_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'expedition_batches',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    product_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'products',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    quantity: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                    },
                    quantity_scanned: {
                        type: Sequelize.INTEGER,
                        defaultValue: 0,
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create EXPEDITION_BATCH_INVOICES table
            await queryInterface.createTable(
                'expedition_batch_invoices',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    expedition_batch_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'expedition_batches',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    invoice_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'invoices',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create EXPEDITION_SCAN_LOGS table
            await queryInterface.createTable(
                'expedition_scan_logs',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    expedition_batch_items_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'expedition_batch_items',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    expedition_batch_invoices_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'expedition_batch_invoices',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    label_full_code: {
                        type: Sequelize.STRING(255),
                        allowNull: false,
                    },
                    vol_number: {
                        type: Sequelize.STRING(6),
                        allowNull: false,
                    },
                    user_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'users',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'RESTRICT',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Create INTEGRATION_MAPPINGS table
            await queryInterface.createTable(
                'integration_mappings',
                {
                    id: {
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.UUIDV4,
                        primaryKey: true,
                        allowNull: false,
                    },
                    entity_type: {
                        type: Sequelize.ENUM('PRODUCT', 'INVOICE'),
                        allowNull: false,
                    },
                    internal_id: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                    },
                    integrations_id: {
                        type: Sequelize.UUID,
                        references: {
                            model: 'integrations',
                            key: 'id'
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'SET NULL',
                    },
                    external_id: {
                        type: Sequelize.STRING(100),
                        allowNull: false,
                    },
                    unit_business_id: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: 'unit_businesses',
                            key: 'id',
                        },
                        onUpdate: 'CASCADE',
                        onDelete: 'CASCADE',
                    },
                    created_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                    updated_at: {
                        type: Sequelize.DATE,
                        allowNull: false,
                        defaultValue: Sequelize.NOW,
                    },
                },
                { transaction }
            );

            // Add unique index for integration mappings
            await queryInterface.addConstraint('integration_mappings', {
                fields: ['entity_type', 'internal_id', 'integrations_id', 'unit_business_id'],
                type: 'unique',
                name: 'integration_mappings_entity_type_internal_id_integrations_id_unit_business_id_unique',
                transaction,
            });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
        
    },
    

    down: async (queryInterface, Sequelize) => {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            await queryInterface.renameColumn('orders', 'integrations_id', 'integration_id', { transaction });
            // Drop tables in reverse order of creation
            await queryInterface.dropTable('integration_mappings', { transaction });
            await queryInterface.dropTable('expedition_scan_logs', { transaction });
            await queryInterface.dropTable('expedition_batch_invoices', { transaction });
            await queryInterface.dropTable('expedition_batch_items', { transaction });
            await queryInterface.dropTable('expedition_batches', { transaction });
            await queryInterface.dropTable('entrance_scan_logs', { transaction });
            await queryInterface.dropTable('invoice_items', { transaction });
            await queryInterface.dropTable('invoices', { transaction });
            await queryInterface.dropTable('stocks', { transaction });
            await queryInterface.dropTable('product_supplier_maps', { transaction });
            await queryInterface.dropTable('products', { transaction });
            await queryInterface.dropTable('users', { transaction });
            await queryInterface.dropTable('transporters', { transaction });
            await queryInterface.dropTable('unit_businesses', { transaction });
            await queryInterface.dropTable('roles', { transaction });

            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
};
