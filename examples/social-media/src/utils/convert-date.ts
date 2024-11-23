export function convertMillisecondsToDate(milliseconds: number): string {
  const date = new Date(milliseconds);

  // Get date components
  const day = date.getDate();
  const month = date.getMonth() + 1; // Months are 0-indexed in JavaScript
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // Format with leading zeros if necessary
  const formattedDay = day.toString().padStart(2, '0');
  const formattedMonth = month.toString().padStart(2, '0');
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');

  return `${formattedDay}/${formattedMonth} ${formattedHours}:${formattedMinutes}`;
}