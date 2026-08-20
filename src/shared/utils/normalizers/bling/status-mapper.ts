import { OrderInternalStatus } from "../../../../modules/sales/orders/order/orders.types"

export const mapOrderInternalStatus = (blingStatus: string | number): OrderInternalStatus => {
    switch (String(blingStatus)) {
        case '12':
            return OrderInternalStatus.CANCELLED
        case '9':
            return OrderInternalStatus.EMITTED
        case '21':
            return OrderInternalStatus.CANCELLED
        case '748748':
            return OrderInternalStatus.WAITING_FOR_NFE_EMISSION
        case '748772':
            return OrderInternalStatus.CANCELLED
        case '748743':
            return OrderInternalStatus.WAITING_CHANNEL_VALIDATION
        case '6':
            return OrderInternalStatus.OPEN
        case '834029':
            return OrderInternalStatus.SENT_TO_TRANSPORTER
        case '834030':
            return OrderInternalStatus.DELIVERED
        default:
            return OrderInternalStatus.UNKNOWN
    }

}