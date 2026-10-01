"use client";
import { useId, useState } from "react";
import type { Poll } from "../../lib/model";
import type { Movement } from "./model";
import { dateLabel } from "./model";
const number = (value: number) =>
  value.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

export function ResultChart({
  poll,
  movement,
}: {
  poll: Poll;
  movement: Movement | null;
}) {
  const id = useId();
  const [tab, setTab] = useState<"chart" | "table">("chart");
  if (poll.kind === "discussion")
    return (
      <p className="chart-note">
        Bu bir tartışma gönderisi; seçenek oylaması bulunmuyor.
      </p>
    );
  if (!poll.results.visible)
    return (
      <p className="chart-note">
        Sonuçlar gizli. Oy sayıları ve dağılım gösterilmiyor.
      </p>
    );
  const rows = movement
    ? [
        {
          label: dateLabel(movement.windowFromEnd),
          percent: movement.fromPercent,
          sample: movement.sampleFrom,
        },
        {
          label: dateLabel(movement.windowToEnd),
          percent: movement.toPercent,
          sample: movement.sampleTo,
        },
      ]
    : poll.results.options.map((option) => ({
        label: poll.options.find((o) => o.id === option.id)?.label || "Seçenek",
        percent: option.percent,
        votes: option.votes,
        sample: poll.results.visible ? poll.results.total : 0,
      }));
  const label = movement
    ? poll.options.find((o) => o.id === movement.optionId)?.label || "Seçenek"
    : "Oy dağılımı";
  return (
    <section className="trend-chart" aria-labelledby={`${id}-title`}>
      <div className="kv-row kv-between chart-heading">
        <h3 id={`${id}-title`}>{label}</h3>
        <div
          className="social-actions"
          role="group"
          aria-label={`${label} görünümü`}
        >
          <button
            className="reaction-button"
            aria-pressed={tab === "chart"}
            onClick={() => setTab("chart")}
          >
            Grafik
          </button>
          <button
            className="reaction-button"
            aria-pressed={tab === "table"}
            onClick={() => setTab("table")}
          >
            Tablo
          </button>
        </div>
      </div>
      {movement && (
        <p className="movement-delta">
          <strong>
            {movement.deltaPoints > 0 ? "+" : ""}
            {number(movement.deltaPoints)} yüzde puan
          </strong>
          <span>
            {" "}
            %{number(movement.fromPercent)} → %{number(movement.toPercent)}
          </span>
        </p>
      )}
      {tab === "chart" ? (
        <div
          className="bar-chart"
          role="img"
          aria-label={rows
            .map(
              (row) =>
                `${row.label}: yüzde ${number(row.percent)}, örneklem ${row.sample} oy`,
            )
            .join("; ")}
        >
          <div className="chart-axis" aria-hidden="true">
            <span>%0</span>
            <span>%50</span>
            <span>%100</span>
          </div>
          {rows.map((row, i) => (
            <div className="chart-row" key={row.label} aria-hidden="true">
              <div className="kv-row kv-between">
                <span>{row.label}</span>
                <strong>%{number(row.percent)}</strong>
              </div>
              <div className="chart-track">
                <div
                  className={`chart-bar chart-bar-${i % 2}`}
                  style={{ width: `${row.percent}%` }}
                />
              </div>
              <small>
                {movement
                  ? `Örneklem: ${number(row.sample)} toplam oy`
                  : `${number((row as { votes: number }).votes)} oy`}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <div className="chart-table-wrap">
          <table>
            <caption>
              {movement
                ? `${label} için dönem sonu karşılaştırması`
                : "Mevcut toplam oy dağılımı"}
            </caption>
            <thead>
              <tr>
                <th scope="col">{movement ? "Dönem sonu" : "Seçenek"}</th>
                <th scope="col">Oran</th>
                <th scope="col">{movement ? "Örneklem" : "Oy"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>%{number(row.percent)}</td>
                  <td>
                    {number(
                      movement ? row.sample : (row as { votes: number }).votes,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="chart-note">
        {movement
          ? "İki dönem sonundaki birikimli dağılımlar karşılaştırılır. Fark yüzde puandır; yeni gelen oyların oranı veya göreli yüzde artış değildir."
          : `Toplam ${number(poll.results.total)} oy. Grafik mevcut birikimli dağılımı gösterir; dönem içi oy sayısı veya trend puanı değildir.`}
      </p>
    </section>
  );
}
