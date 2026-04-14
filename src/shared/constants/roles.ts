type Actions = 'read' | 'write' | 'delete' | 'update';
type Scopes = 'Pedidos' | 'Notas Fiscais' | 'users' | 'batch';

interface Roles {
    scope: Scopes;
    entity: string;
    permissions: Actions[]
}

const permissions_allowed:Actions[] = ['read', 'write', 'delete', 'update']

export const ROLE_PERMISSIONS: Roles[] = [
    {
        scope: 'Pedidos',
        entity: 'orders',
        permissions: permissions_allowed
    },
    {
        scope: 'Notas Fiscais',
        entity: 'invoices',
        permissions: permissions_allowed
    }
]

// const selectPermissions = (scope: Scopes, permissions: Actions[]) => {
//     const selectedScope = ROLE_PERMISSIONS.find(s => s.scope == scope)
   
//     return {
//         scope: selectedScope?.scope,
//         entity: selectedScope?.entity,
//         permissions,
//     }
// }