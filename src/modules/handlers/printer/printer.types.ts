export interface PrinterConfigAttributes {
  id: string
  unit_business_id: string
  server_ip: string
  printer_name: string
  is_active: boolean
}

export interface PrinterConfigCreationAttributes extends Omit<PrinterConfigAttributes, 'id'> {}