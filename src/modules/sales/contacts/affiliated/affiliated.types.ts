/** Payload enxuto do login/me do afiliado — o front do afiliado não recebe o user completo. */
export interface AffiliatedProfile {
  name: string;
  unit_business: {
    number: string | null;
    name: string | null;
  };
}
