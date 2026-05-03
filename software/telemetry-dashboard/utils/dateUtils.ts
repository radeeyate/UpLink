/**
 * Converts a Unix timestamp (seconds) into a formatted time string.
 */
export const formatTimestamp = (unixTime: number | undefined | null): string => {
  if (unixTime === undefined || unixTime === null || isNaN(unixTime)) {
    return "";
  }
  
  const date = new Date(unixTime * 1000); 
  
  return date.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
};