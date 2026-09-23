// Reading a school class out of a profile's free-text class field.
//
// Two places need the same answer: checkout, which only sells psychometric
// plans to classes 7 to 12, and the Mindler handoff, which picks the Stream or
// Career test from the class. If each parsed it their own way, a student could
// be allowed to buy a test the handoff then cannot place them in.

// The psychometric test is written for school students, so the 2026 plans sheet
// offers every package that bundles it to classes 7 to 12 only.
export const PSYCHOMETRIC_MIN_CLASS = 7
export const PSYCHOMETRIC_MAX_CLASS = 12

/**
 * The class number hiding in a profile's free-text class, or null when there is
 * nothing usable there. Students write 'Class 9', '9', '10th' and everything in
 * between, so take the first standalone one- or two-digit number. A longer run
 * of digits is a year or a phone number, never a class, so it is left alone.
 *
 * The college entries the site offers ('1st Year Undergraduate' … '2nd Year
 * Masters / PG') read as 1 to 5, below the psychometric band, so they are
 * refused at checkout rather than mistaken for a school class.
 */
export const parseStudentClass = (raw) => {
  const match = String(raw || '').match(/(?<!\d)\d{1,2}(?!\d)/)
  if (!match) return null
  const n = Number(match[0])
  return n > 0 ? n : null
}
