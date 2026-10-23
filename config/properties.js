/**
 * The four Azzurro properties being monitored.
 *
 * `slug` is Booking.com's page name (the stable identifier in the URL) and is
 * what every review is keyed on. `name` is the operations-facing label; the
 * Booking.com listing titles differ from the internal names (e.g. "Central
 * Sydney" is listed at /venus-surry-hills), so we never derive one from the other.
 */
export const PROPERTIES = [
  {
    slug: 'olympic-paddington',
    name: 'Olympic Hotel Paddington',
    shortName: 'Paddington',
    url: 'https://www.booking.com/hotel/au/olympic-paddington.html',
  },
  {
    slug: 'venus-potts-point-sydney',
    name: 'Potts Point',
    shortName: 'Potts Point',
    url: 'https://www.booking.com/hotel/au/venus-potts-point-sydney.html',
  },
  {
    slug: 'venus-surry-hills',
    name: 'Central Sydney',
    shortName: 'Central',
    url: 'https://www.booking.com/hotel/au/venus-surry-hills.html',
  },
  {
    slug: 'chateau-de-venus',
    name: 'Darling Harbour',
    shortName: 'Darling Harbour',
    url: 'https://www.booking.com/hotel/au/chateau-de-venus.html',
  },
];

export const PROPERTY_BY_SLUG = Object.fromEntries(PROPERTIES.map((p) => [p.slug, p]));

/** English (UK) version of the listing: the date and score parsers expect English text. */
export function listingUrl(property) {
  return property.url.replace(/\.html$/, '.en-gb.html');
}

/** All "week" maths is done in the hotels' local time. */
export const HOTEL_TIMEZONE = 'Australia/Sydney';
