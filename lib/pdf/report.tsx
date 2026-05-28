import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { IhcEntry } from "@/lib/db/queries/reports";

export interface ReportPdfData {
  caseNumber: string;
  createdAt: number;
  signedAt: number;
  signerName: string;
  signerCredentials: string;
  age: number;
  sex: string;
  specimenType: string;
  clinicalHistory: string;
  microscopy: string;
  diagnosis: string;
  differential: string;
  recommendations: string;
  additionalNotes: string;
  ihc: IhcEntry[];
  audit: { eventCount: number; rootHash: string; signerHash: string };
}

const s = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#111", lineHeight: 1.4 },
  letterhead: { borderBottom: "2 solid #1d4ed8", paddingBottom: 8, marginBottom: 16 },
  org: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1d4ed8" },
  sub: { fontSize: 9, color: "#555" },
  hdrRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  caseNo: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4, color: "#1d4ed8" },
  body: { fontSize: 10, marginBottom: 4 },
  ihcRow: { flexDirection: "row", borderBottom: "0.5 solid #ddd", paddingVertical: 2 },
  ihcCell: { flex: 1 },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, borderTop: "1 solid #ddd", paddingTop: 6, fontSize: 7, color: "#777" },
});

function Section({ title, text }: { title: string; text: string }) {
  if (!text?.trim()) return null;
  return (
    <View>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.body}>{text}</Text>
    </View>
  );
}

function ReportDoc({ d }: { d: ReportPdfData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.letterhead}>
          <Text style={s.org}>AIIMS Delhi — Department of Pathology</Text>
          <Text style={s.sub}>PathConsult digital consultation report</Text>
        </View>

        <View style={s.hdrRow}>
          <View>
            <Text style={s.caseNo}>{d.caseNumber}</Text>
            <Text style={s.sub}>
              Age {d.age} · {d.sex} · {d.specimenType.replace(/_/g, " ")}
            </Text>
          </View>
          <View>
            <Text style={s.sub}>Created: {new Date(d.createdAt).toLocaleDateString()}</Text>
            <Text style={s.sub}>Signed: {new Date(d.signedAt).toLocaleString()}</Text>
            <Text style={s.sub}>
              Signed by: {d.signerName}
              {d.signerCredentials ? `, ${d.signerCredentials}` : ""}
            </Text>
          </View>
        </View>

        <Section title="Clinical history" text={d.clinicalHistory} />
        <Section title="Microscopy" text={d.microscopy} />
        <Section title="Diagnosis" text={d.diagnosis} />
        <Section title="Differential considerations" text={d.differential} />

        {d.ihc.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>IHC results</Text>
            <View style={[s.ihcRow, { borderBottom: "1 solid #999" }]}>
              <Text style={[s.ihcCell, { fontFamily: "Helvetica-Bold" }]}>Stain</Text>
              <Text style={[s.ihcCell, { fontFamily: "Helvetica-Bold" }]}>Result</Text>
              <Text style={[s.ihcCell, { fontFamily: "Helvetica-Bold" }]}>Notes</Text>
            </View>
            {d.ihc.map((i, idx) => (
              <View key={idx} style={s.ihcRow}>
                <Text style={s.ihcCell}>{i.stain}</Text>
                <Text style={s.ihcCell}>{i.result}</Text>
                <Text style={s.ihcCell}>{i.notes ?? ""}</Text>
              </View>
            ))}
          </View>
        )}

        <Section title="Recommendations" text={d.recommendations} />
        <Section title="Additional notes" text={d.additionalNotes} />

        <View style={s.footer} fixed>
          <Text>
            Audit chain: {d.audit.eventCount} events · root {d.audit.rootHash.slice(0, 16)}… ·
            signature {d.audit.signerHash.slice(0, 16)}…
          </Text>
          <Text>
            This report was produced via PathConsult. The diagnostic decision is the
            signing pathologist's.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(d: ReportPdfData): Promise<Buffer> {
  return renderToBuffer(<ReportDoc d={d} />);
}
