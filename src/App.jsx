import { useState, useRef } from "react";

const MODELS = {
  "Intimação Positiva": {
    template: `CERTIDÃO DE DILIGÊNCIA – Intimação Positiva\n\nDirigi-me à {endereco} no dia {data}, às {hora}, ocasião em que procedi à INTIMAÇÃO de {nome}, ao qual li o inteiro teor do mandado, tendo exarado o seu ciente e aceitado a contrafé.`,
    fields: ["endereco", "data", "hora", "nome"],
    labels: { endereco: "Endereço", data: "Data", hora: "Hora", nome: "Nome do Intimado" },
    hint: "Ex: Rua das Flores 10, 10 de junho, 14h30, João Silva"
  },
  "Intimação Negativa": {
    template: `CERTIDÃO DE DILIGÊNCIA – Intimação Negativa\n\nDirigi-me à {endereco} no dia {data}, às {hora}, ocasião em que, após diligenciar no local, não logrei êxito em intimar {nome}, por {motivo}.`,
    fields: ["endereco", "data", "hora", "nome", "motivo"],
    labels: { endereco: "Endereço", data: "Data", hora: "Hora", nome: "Nome do Intimado", motivo: "Motivo" },
    hint: "Ex: Rua das Flores 10, 10 de junho, 14h30, João Silva, não encontrado"
  },
  "Citação Positiva": {
    template: `CERTIDÃO DE DILIGÊNCIA – Citação Positiva\n\nDirigi-me à {endereco} no dia {data}, às {hora}, ocasião em que procedi à CITAÇÃO de {nome}, ao qual li o inteiro teor do mandado, tendo o mesmo exarado o seu ciente e recebido a contrafé.`,
    fields: ["endereco", "data", "hora", "nome"],
    labels: { endereco: "Endereço", data: "Data", hora: "Hora", nome: "Nome do Citando" },
    hint: "Ex: Rua das Flores 10, 10 de junho, 14h30, João Silva"
  },
  "Citação Negativa": {
    template: `CERTIDÃO DE DILIGÊNCIA – Citação Negativa\n\nDirigi-me à {endereco} no dia {data}, às {hora}, ocasião em que, após diligenciar no local, não logrei êxito em citar {nome}, por {motivo}.`,
    fields: ["endereco", "data", "hora", "nome", "motivo"],
    labels: { endereco: "Endereço", data: "Data", hora: "Hora", nome: "Nome do Citando", motivo: "Motivo" },
    hint: "Ex: Rua das Flores 10, 10 de junho, 14h30, João Silva, não encontrado"
  },
  "Penhora": {
    template: `CERTIDÃO DE DILIGÊNCIA – Penhora\n\nDirigi-me à {endereco} no dia {data}, às {hora}, ocasião em que procedi à PENHORA de {bem}, pertencente a {nome}, avaliado em R$ {valor}, deixado sob a guarda de {depositario}.`,
    fields: ["endereco", "data", "hora", "bem", "nome", "valor", "depositario"],
    labels: { endereco: "Endereço", data: "Data", hora: "Hora", bem: "Bem Penhorado", nome: "Nome do Executado", valor: "Valor (R$)", depositario: "Depositário" },
    hint: "Ex: Rua das Flores 10, 10 de junho, 14h30, veículo Fiat Uno, João Silva, 15000, o próprio devedor"
  },
};

const SYSTEM_PROMPT = `Você é um assistente especializado em extrair informações de transcrições de áudio de oficiais de justiça brasileiros.

Você receberá uma transcrição de áudio informal e uma lista de campos para extrair.

Retorne APENAS um objeto JSON válido com os campos solicitados preenchidos.
Formate datas por extenso: "10 de junho de 2025"
Formate horas assim: "14h30min"
Se não encontrar uma informação, use: "não informado"
Não inclua explicações, apenas o JSON.`;

export default function DiligensCertidAI() {
  const [selectedModel, setSelectedModel] = useState("Intimação Positiva");
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [certidao, setCertidao] = useState("");
  const [step, setStep] = useState("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const modelo = MODELS[selectedModel];

  const startRecording = async () => {
    setError("");
    setCertidao("");
    setTranscript("");
    setAudioBlob(null);
    setCopied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start();
      setRecording(true);
      setStep("recording");
    } catch (err) {
      setError("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      setStep("idle");
    }
  };

  const blobToBase64 = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });

  const transcribeAndGenerate = async () => {
    if (!audioBlob) return;
    setError("");
    setStep("transcribing");

    try {
      // Step 1: Transcrever
      const base64Audio = await blobToBase64(audioBlob);
      const transcribeRes = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio }),
      });
      if (!transcribeRes.ok) throw new Error("Erro na transcrição. Verifique a chave OpenAI.");
      const transcribeData = await transcribeRes.json();
      const transcribedText = transcribeData.text;
      setTranscript(transcribedText);
      setStep("generating");

      // Step 2: Extrair campos com Claude
      const fieldsStr = modelo.fields.map(f => `"${f}": "${modelo.labels[f]}"`).join(", ");
      const userPrompt = `Extraia as seguintes informações da transcrição e retorne como JSON:\nCampos: {${fieldsStr}}\n\nTranscrição: "${transcribedText}"`;

      const generateRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
      });
      if (!generateRes.ok) throw new Error("Erro ao gerar certidão. Verifique a chave Anthropic.");
      const generateData = await generateRes.json();
      const jsonText = generateData.text.replace(/```json|```/g, "").trim();
      const fields = JSON.parse(jsonText);

      // Step 3: Preencher template
      let result = modelo.template;
      for (const [key, value] of Object.entries(fields)) {
        result = result.replace(`{${key}}`, value);
      }
      setCertidao(result);
      setStep("done");
    } catch (err) {
      setError(err.message || "Erro inesperado. Tente novamente.");
      setStep("idle");
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(certidao).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reset = () => {
    setStep("idle");
    setCertidao("");
    setTranscript("");
    setAudioBlob(null);
    setError("");
    setCopied(false);
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0d1117", color: "#e6edf3", fontFamily: "'Georgia', serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", marginBottom: "32px", width: "100%", maxWidth: "600px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#8b8fa8", textTransform: "uppercase", marginBottom: "8px" }}>Oficial de Justiça · SP</div>
        <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#c9a84c", margin: "0 0 4px 0", letterSpacing: "1px" }}>DiligensCertidAI</h1>
        <div style={{ width: "48px", height: "2px", backgroundColor: "#c9a84c", margin: "8px auto" }} />
        <p style={{ fontSize: "13px", color: "#8b8fa8", margin: 0 }}>Grave as informações · Receba a certidão pronta</p>
      </div>

      <div style={{ width: "100%", maxWidth: "600px" }}>
        {/* Model Selector */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>Modelo de Certidão</label>
          <select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); reset(); }} disabled={step === "recording" || step === "transcribing" || step === "generating"}
            style={{ width: "100%", padding: "12px 16px", backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "6px", color: "#e6edf3", fontSize: "14px", fontFamily: "'Georgia', serif", cursor: "pointer", outline: "none" }}>
            {Object.keys(MODELS).map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </div>

        {/* Fields hint */}
        <div style={{ backgroundColor: "#161b22", border: "1px solid #21262d", borderLeft: "3px solid #c9a84c", borderRadius: "6px", padding: "14px 16px", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#c9a84c", textTransform: "uppercase", marginBottom: "8px" }}>Fale no áudio:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
            {modelo.fields.map(f => (
              <span key={f} style={{ backgroundColor: "#21262d", border: "1px solid #30363d", borderRadius: "4px", padding: "4px 10px", fontSize: "12px", color: "#e6edf3" }}>{modelo.labels[f]}</span>
            ))}
          </div>
          <div style={{ fontSize: "12px", color: "#8b8fa8", fontStyle: "italic" }}>{modelo.hint}</div>
        </div>

        {/* Recording Controls */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          {!recording ? (
            <button onClick={startRecording} disabled={step === "transcribing" || step === "generating"}
              style={{ flex: 1, padding: "16px", backgroundColor: step === "transcribing" || step === "generating" ? "#21262d" : "#c9a84c", color: step === "transcribing" || step === "generating" ? "#8b8fa8" : "#0d1117", border: "none", borderRadius: "6px", fontSize: "15px", fontWeight: "700", fontFamily: "'Georgia', serif", cursor: "pointer" }}>
              🎙️ Iniciar Gravação
            </button>
          ) : (
            <button onClick={stopRecording}
              style={{ flex: 1, padding: "16px", backgroundColor: "#da3633", color: "#fff", border: "none", borderRadius: "6px", fontSize: "15px", fontWeight: "700", fontFamily: "'Georgia', serif", cursor: "pointer" }}>
              ⏹ Parar Gravação
            </button>
          )}
          {audioBlob && step === "idle" && (
            <button onClick={transcribeAndGenerate}
              style={{ flex: 1, padding: "16px", backgroundColor: "#238636", color: "#fff", border: "none", borderRadius: "6px", fontSize: "15px", fontWeight: "700", fontFamily: "'Georgia', serif", cursor: "pointer" }}>
              ✅ Gerar Certidão
            </button>
          )}
        </div>

        {step === "recording" && (
          <div style={{ textAlign: "center", color: "#da3633", fontSize: "13px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#da3633", animation: "pulse 1s infinite" }} />
            Gravando...
          </div>
        )}

        {audioBlob && step === "idle" && (
          <div style={{ textAlign: "center", color: "#3fb950", fontSize: "13px", marginBottom: "16px" }}>✓ Áudio gravado — clique em "Gerar Certidão"</div>
        )}

        {(step === "transcribing" || step === "generating") && (
          <div style={{ backgroundColor: "#161b22", border: "1px solid #30363d", borderRadius: "6px", padding: "20px", textAlign: "center", marginBottom: "20px" }}>
            <div style={{ fontSize: "24px", marginBottom: "10px" }}>{step === "transcribing" ? "🎧" : "⚖️"}</div>
            <div style={{ color: "#c9a84c", fontSize: "14px", fontWeight: "600" }}>{step === "transcribing" ? "Transcrevendo áudio..." : "Gerando certidão..."}</div>
          </div>
        )}

        {transcript && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>Transcrição</label>
            <div style={{ backgroundColor: "#161b22", border: "1px solid #21262d", borderRadius: "6px", padding: "14px 16px", fontSize: "13px", color: "#8b8fa8", lineHeight: "1.6", fontStyle: "italic" }}>"{transcript}"</div>
          </div>
        )}

        {certidao && step === "done" && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>Certidão Gerada</label>
            <div style={{ backgroundColor: "#0d1117", border: "1px solid #c9a84c", borderRadius: "6px", padding: "20px", fontSize: "14px", lineHeight: "1.9", color: "#e6edf3", whiteSpace: "pre-wrap" }}>{certidao}</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button onClick={copyToClipboard}
                style={{ flex: 1, padding: "12px", backgroundColor: copied ? "#238636" : "#21262d", color: copied ? "#fff" : "#c9a84c", border: `1px solid ${copied ? "#238636" : "#c9a84c"}`, borderRadius: "6px", fontSize: "13px", fontFamily: "'Georgia', serif", cursor: "pointer" }}>
                {copied ? "✓ Copiado!" : "📋 Copiar Certidão"}
              </button>
              <button onClick={reset}
                style={{ padding: "12px 20px", backgroundColor: "transparent", color: "#8b8fa8", border: "1px solid #30363d", borderRadius: "6px", fontSize: "13px", fontFamily: "'Georgia', serif", cursor: "pointer" }}>
                Nova Diligência
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{ backgroundColor: "#1c0a0a", border: "1px solid #da3633", borderRadius: "6px", padding: "14px 16px", color: "#da3633", fontSize: "13px", marginBottom: "16px" }}>
            ⚠️ {error}
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } } select option { background-color: #161b22; }`}</style>
    </div>
  );
}
