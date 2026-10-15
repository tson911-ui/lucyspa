import type { ReactNode } from 'react';

/**
 * A table inside the text of an information page (a refund schedule, a list of membership tiers). It is prose, not a data list:
 * the cells hold sentences and wrap, there is no sorting or paging, and the header row names every column. Below 640 px each row
 * becomes a stacked card whose values carry their column name (CSS reads `data-label`), so nothing scrolls sideways.
 */
export function InfoTable({
  header,
  rows,
}: {
  /** The column names, already drawn (text or inline elements) and their plain text for the phone labels. */
  header: readonly { node: ReactNode; label: string }[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="ls-info-table-wrap">
      <table className="ls-info-table">
        <thead>
          <tr>
            {header.map((column, index) => (
              <th key={index} scope="col">
                {column.node}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index} data-label={header[index]?.label}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
