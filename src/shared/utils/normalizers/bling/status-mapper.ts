export const mapOrder = (blingStatus: string | number) => {
    switch (String(blingStatus)) {
        case '12':
            return 'CANCELLED'
        case '9':
            return 'EMITTED'
        case '21':
            return 'CANCELLED'
        case '748748':
            return 'WAITING FOR NFE EMISSION'
        case '748772':
            return 'CANCELLED'
        case '748743':
            return 'WAITING CHANNEL VALIDATION'
        case '6':
            return 'OPEN'
        default:
            return 'UNKNOWN'
    }

}