import { useState, useRef } from "react";

const MODELS = {
  "Intimação Positiva": `CERTIDÃO DE DILIGÊNCIA – Intimação Positiva

Dirigi-me à [endereço] no dia [data], às [hora], ocasião em que procedi à INTIMAÇÃO de [nome do intimado], ao qual li o inteiro teor do mandado, tendo exarado o seu ciente e aceitado a contrafé.`,

  "Intimação Negativa": `CERTIDÃO DE DILIGÊNCIA – Intimação Negativa

Dirigi-me à [endereço] no dia [data], às [hora], ocasião em que, após diligenciar no local, não logrei êxito em intimar [nome do intimado], por [motivo: não ser encontrado / recusa / local fechado / etc].`,

  "Citação Positiva": `CERTIDÃO DE DILIGÊNCIA – Citação Positiva

Dirigi-me à [endereço] no dia [data], às [hora], ocasião em que procedi à CITAÇÃO de [nome do citando], ao qual li o inteiro teor do mandado, tendo o mesmo exarado o seu ciente e recebido a contrafé.`,

  "Citação Negativa": `CERTIDÃO DE DILIGÊNCIA – Citação Negativa

Dirigi-me à [endereço] no dia [data], às [hora], ocasião em que, após diligenciar no local, não logrei êxito em citar [nome do citando], por [motivo].`,

  "Penhora": `CERTIDÃO DE DILIGÊNCIA – Penhora

Dirigi-me à [endereço] no dia [data], às [hora], ocasião em que procedi à PENHORA de [descrição do bem], pertencente a [nome do executado], o qual foi avaliado em R$ [valor] e deixado sob a guarda de [depositário].`,
};

const SYSTEM_PROMPT = `Você é um assistente especializado em redigir certidões de diligência para oficiais de justiça do Brasil, conforme o CPC.

Você receberá uma transcrição de áudio informal do oficial de justiça descrevendo a diligência realizada, e um modelo de certidão com campos entre colchetes.

Sua tarefa:
1. Extrair as informações relevantes da transcrição (endereço, data, hora, nomes, resultados, etc.)
2. Preencher o modelo com essas informações de forma precisa e formal
3. Ajustar o texto para garantir coerência jurídica e linguagem formal
4. Se alguma informação não foi mencionada no áudio, deixe [informação não fornecida] no campo correspondente
5. Retornar APENAS o texto da certidão, sem explicações adicionais, sem marcações markdown

Importante:
- Use linguagem jurídica formal (primeira pessoa: "dirigi-me", "procedi à", etc.)
- Datas por extenso: "10 de junho de 2025"
- Horas no formato: "12h15min"
- Nomes em CAIXA ALTA quando se referir ao intimado/citando`;

export default function DiligensCertidAI() {
  const [selectedModel, setSelectedModel] = useState("Intimação Positiva");
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [certidao, setCertidao] = useState("");
  const [step, setStep] = useState("idle"); // idle | recording | transcribing | generating | done
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const startRecording = async () => {
    setError("");
    setCertidao("");
    setTranscript("");
    setAudioBlob(null);
    setCopied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setRecording(true);
      setStep("recording");
    } catch (err) {
      setError("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      setStep("idle");
    }
  };

  const transcribeAndGenerate = async () => {
    if (!audioBlob) return;
    setError("");
    setStep("transcribing");

    try {
      // Step 1: Transcribe with Whisper
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", "whisper-1");
      formData.append("language", "pt");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env?.VITE_OPENAI_KEY || ""}`,
        },
        body: formData,
      });

      if (!whisperRes.ok) {
        const errData = await whisperRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || "Erro na transcrição. Verifique a chave OpenAI.");
      }

      const whisperData = await whisperRes.json();
      const transcribedText = whisperData.text;
      setTranscript(transcribedText);
      setStep("generating");

      // Step 2: Generate certidão with Claude
      const modelo = MODELS[selectedModel];
      const userPrompt = `Modelo de certidão a preencher:\n\n${modelo}\n\n---\n\nTranscrição do áudio do oficial de justiça:\n\n"${transcribedText}"`;

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "", // handled by proxy
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!claudeRes.ok) {
        const errData = await claudeRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || "Erro ao gerar certidão.");
      }

      const claudeData = await claudeRes.json();
      const resultText = claudeData.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      setCertidao(resultText);
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
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#0d1117",
      color: "#e6edf3",
      fontFamily: "'Georgia', serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px 16px",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "32px", width: "100%", maxWidth: "600px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#8b8fa8", textTransform: "uppercase", marginBottom: "8px" }}>
          Oficial de Justiça · SP
        </div>
        <h1 style={{
          fontSize: "28px",
          fontWeight: "700",
          color: "#c9a84c",
          margin: "0 0 4px 0",
          letterSpacing: "1px",
        }}>
          DiligensCertidAI
        </h1>
        <div style={{ width: "48px", height: "2px", backgroundColor: "#c9a84c", margin: "8px auto" }} />
        <p style={{ fontSize: "13px", color: "#8b8fa8", margin: 0 }}>
          Grave o áudio da diligência · Receba a certidão pronta
        </p>
      </div>

      <div style={{ width: "100%", maxWidth: "600px" }}>

        {/* Model Selector */}
        <div style={{ marginBottom: "24px" }}>
          <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
            Modelo de Certidão
          </label>
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); reset(); }}
            disabled={step === "recording" || step === "transcribing" || step === "generating"}
            style={{
              width: "100%",
              padding: "12px 16px",
              backgroundColor: "#161b22",
              border: "1px solid #30363d",
              borderRadius: "6px",
              color: "#e6edf3",
              fontSize: "14px",
              fontFamily: "'Georgia', serif",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {Object.keys(MODELS).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Model Preview */}
        <div style={{
          backgroundColor: "#161b22",
          border: "1px solid #21262d",
          borderLeft: "3px solid #c9a84c",
          borderRadius: "6px",
          padding: "14px 16px",
          marginBottom: "28px",
          fontSize: "12px",
          color: "#8b8fa8",
          lineHeight: "1.7",
          whiteSpace: "pre-wrap",
        }}>
          {MODELS[selectedModel]}
        </div>

        {/* Recording Controls */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={step === "transcribing" || step === "generating"}
              style={{
                flex: 1,
                padding: "16px",
                backgroundColor: step === "transcribing" || step === "generating" ? "#21262d" : "#c9a84c",
                color: step === "transcribing" || step === "generating" ? "#8b8fa8" : "#0d1117",
                border: "none",
                borderRadius: "6px",
                fontSize: "15px",
                fontWeight: "700",
                fontFamily: "'Georgia', serif",
                cursor: step === "transcribing" || step === "generating" ? "not-allowed" : "pointer",
                letterSpacing: "0.5px",
                transition: "opacity 0.2s",
              }}
            >
              🎙️ Iniciar Gravação
            </button>
          ) : (
            <button
              onClick={stopRecording}
              style={{
                flex: 1,
                padding: "16px",
                backgroundColor: "#da3633",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "15px",
                fontWeight: "700",
                fontFamily: "'Georgia', serif",
                cursor: "pointer",
                animation: "pulse 1.5s infinite",
              }}
            >
              ⏹ Parar Gravação
            </button>
          )}

          {audioBlob && step === "idle" && (
            <button
              onClick={transcribeAndGenerate}
              style={{
                flex: 1,
                padding: "16px",
                backgroundColor: "#238636",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "15px",
                fontWeight: "700",
                fontFamily: "'Georgia', serif",
                cursor: "pointer",
              }}
            >
              ✅ Gerar Certidão
            </button>
          )}
        </div>

        {/* Recording indicator */}
        {step === "recording" && (
          <div style={{
            textAlign: "center",
            color: "#da3633",
            fontSize: "13px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}>
            <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#da3633", animation: "pulse 1s infinite" }} />
            Gravando... Fale o endereço, data, hora e nome do intimado
          </div>
        )}

        {/* Audio ready */}
        {audioBlob && step === "idle" && (
          <div style={{ textAlign: "center", color: "#3fb950", fontSize: "13px", marginBottom: "16px" }}>
            ✓ Áudio gravado — clique em "Gerar Certidão"
          </div>
        )}

        {/* Loading states */}
        {(step === "transcribing" || step === "generating") && (
          <div style={{
            backgroundColor: "#161b22",
            border: "1px solid #30363d",
            borderRadius: "6px",
            padding: "20px",
            textAlign: "center",
            marginBottom: "20px",
          }}>
            <div style={{ fontSize: "24px", marginBottom: "10px" }}>
              {step === "transcribing" ? "🎧" : "⚖️"}
            </div>
            <div style={{ color: "#c9a84c", fontSize: "14px", fontWeight: "600" }}>
              {step === "transcribing" ? "Transcrevendo áudio..." : "Gerando certidão..."}
            </div>
            <div style={{ color: "#8b8fa8", fontSize: "12px", marginTop: "6px" }}>
              {step === "transcribing" ? "Whisper está processando sua fala" : "Claude está redigindo o documento"}
            </div>
          </div>
        )}

        {/* Transcript */}
        {transcript && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
              Transcrição do Áudio
            </label>
            <div style={{
              backgroundColor: "#161b22",
              border: "1px solid #21262d",
              borderRadius: "6px",
              padding: "14px 16px",
              fontSize: "13px",
              color: "#8b8fa8",
              lineHeight: "1.6",
              fontStyle: "italic",
            }}>
              "{transcript}"
            </div>
          </div>
        )}

        {/* Certidão Result */}
        {certidao && step === "done" && (
          <div style={{ marginBottom: "20px" }}>
            <label style={{ fontSize: "11px", letterSpacing: "2px", color: "#8b8fa8", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
              Certidão Gerada
            </label>
            <div style={{
              backgroundColor: "#0d1117",
              border: "1px solid #c9a84c",
              borderRadius: "6px",
              padding: "20px",
              fontSize: "14px",
              lineHeight: "1.9",
              color: "#e6edf3",
              whiteSpace: "pre-wrap",
            }}>
              {certidao}
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                onClick={copyToClipboard}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: copied ? "#238636" : "#21262d",
                  color: copied ? "#fff" : "#c9a84c",
                  border: `1px solid ${copied ? "#238636" : "#c9a84c"}`,
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontFamily: "'Georgia', serif",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {copied ? "✓ Copiado!" : "📋 Copiar Certidão"}
              </button>
              <button
                onClick={reset}
                style={{
                  padding: "12px 20px",
                  backgroundColor: "transparent",
                  color: "#8b8fa8",
                  border: "1px solid #30363d",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontFamily: "'Georgia', serif",
                  cursor: "pointer",
                }}
              >
                Nova Diligência
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            backgroundColor: "#1c0a0a",
            border: "1px solid #da3633",
            borderRadius: "6px",
            padding: "14px 16px",
            color: "#da3633",
            fontSize: "13px",
            marginBottom: "16px",
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Note about API keys */}
        <div style={{
          marginTop: "8px",
          padding: "12px 14px",
          backgroundColor: "#161b22",
          border: "1px solid #21262d",
          borderRadius: "6px",
          fontSize: "11px",
          color: "#8b8fa8",
          lineHeight: "1.6",
        }}>
          <strong style={{ color: "#c9a84c" }}>⚙️ Para usar localmente:</strong> este app precisa de uma chave OpenAI (Whisper) para transcrição e da API Anthropic (Claude) para gerar as certidões. Posso montar a versão completa com backend Node.js se preferir.
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        select option { background-color: #161b22; }
      `}</style>
    </div>
  );
}
