// Google Maps search link for a business name. Opens its Google Business
// Profile (website button, reviews, photos, categories) without a Places
// API call, so it costs nothing and works on scans saved before this.
export function mapsLink(name: string, area?: string): string {
  const query = area ? `${name} ${area}` : name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export const DEFAULT_AREA = "Grayson County, Kentucky";
