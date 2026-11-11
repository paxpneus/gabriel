// Fachada de labels (etiquetas de volume); nunca exporta controller.
export { default as labelService, LabelService } from "./services/labels.service";
export type { LabelVolume, LabelData, LabelVolumeDTO, LabelDataDTO } from "./services/labels.service";
