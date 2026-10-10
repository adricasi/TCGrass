import { useEffect, useState } from "preact/hooks";

import type { ExpansionResponse } from "../../src/shared/schemas/expansion.js";
import { getExpansion } from "./api.js";
import { oddsRows } from "./binder-view.js";
import { rarityPresentation } from "./rarity.js";

/** The active expansion's rarity odds, exactly as loaded from its file (AC-005.4). */
export function Odds() {
  const [expansion, setExpansion] = useState<ExpansionResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getExpansion()
      .then(setExpansion)
      .catch(() => {
        setFailed(true);
      });
  }, []);

  if (failed) {
    return <p role="alert">Couldn't load the odds. Check your connection and try again.</p>;
  }
  if (expansion === null) {
    return <p>Loading odds…</p>;
  }
  return (
    <section class="odds">
      <h2>Odds · {expansion.name}</h2>
      <p>Every capture rolls its rarity on the server with these odds.</p>
      <table>
        <tbody>
          {oddsRows(expansion.rarityOdds).map((row) => (
            <tr key={row.rarity} class={rarityPresentation(row.rarity).frameClass}>
              <th scope="row">
                <span class="card-rarity">{row.label}</span>
              </th>
              <td>{row.percent} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
