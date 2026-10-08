/** 비어 있는 값은 0이 아니라 N/A로 표시한다 */
export const formatCtr = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);
export const formatPosition = (value: number | null) => (value === null ? "N/A" : value.toFixed(1));
