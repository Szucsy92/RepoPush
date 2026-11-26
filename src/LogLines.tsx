// The log, one line per row. A success mark ✔ is green and a failure mark ✖ is red (fixed colours, whatever the theme is),
// so the outcome of a run stands out at a glance.
const MARK = /(✔|✖)/;

export function LogLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i}>
          {l
            ? l.split(MARK).map((part, j) =>
                part === "✔" ? <span key={j} className="font-bold text-ok">✔</span>
                : part === "✖" ? <span key={j} className="font-bold text-destructive">✖</span>
                : part,
              )
            : "\u200b"}
        </div>
      ))}
    </>
  );
}
