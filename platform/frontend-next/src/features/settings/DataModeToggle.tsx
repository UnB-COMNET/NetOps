"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { API_BASE } from "@/lib/api";

type SystemSettings = {
  use_real_data: boolean;
  auto_collect_enabled: boolean;
  collect_interval_sec: number;
  real_collection_available: boolean;
};

export function DataModeToggle() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log("[DataModeToggle] Fetching from:", `${API_BASE}/system/settings`);
      const res = await fetch(`${API_BASE}/system/settings`, {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      console.log("[DataModeToggle] Response status:", res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemSettings = await res.json();
      console.log("[DataModeToggle] Data received:", data);
      setSettings(data);
    } catch (err: any) {
      console.error("[DataModeToggle] Error:", err);
      setError(err.message ?? "Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (updates: Partial<SystemSettings>) => {
    try {
      setUpdating(true);
      setError(null);
      const res = await fetch(`${API_BASE}/system/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemSettings = await res.json();
      setSettings(data);
    } catch (err: any) {
      setError(err.message ?? "Erro ao atualizar configurações");
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
        <div className="text-[11px] text-fg-1">Carregando configurações...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 p-3">
        <div className="mb-1 text-[11px] font-semibold text-accent-danger">Erro ao carregar configurações</div>
        <div className="text-[10px] text-accent-danger/80">{error ?? "Erro desconhecido"}</div>
        <Button variant="ghost" className="mt-2 h-7 text-[10px]" onClick={fetchSettings}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-blue-500/60 bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-2xl">⚙️</div>
          <div>
            <div className="text-sm font-bold text-blue-300">MODO DE COLETA DE DADOS</div>
            <div className="text-[10px] text-blue-200/60">Sintético (demo) ou Real (produção)</div>
          </div>
        </div>
        {settings.real_collection_available && (
          <div className="rounded-full bg-accent-ok/20 px-3 py-1 text-[10px] font-medium text-accent-ok">
            ✓ Coleta Real Disponível
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-accent-danger/40 bg-accent-danger/10 p-2 text-[10px] text-accent-danger">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Toggle Principal: GRANDE e VISÍVEL */}
        <div className="flex items-center gap-4 rounded-lg border-2 border-border-0/60 bg-bg-1/60 p-4">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-3">
              <div className="text-3xl">{settings.use_real_data ? "🔴" : "🟢"}</div>
              <div>
                <div className="text-base font-bold text-fg-0">
                  {settings.use_real_data ? "Dados REAIS" : "Dados SINTÉTICOS"}
                </div>
                <div
                  className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold inline-block ${
                    settings.use_real_data
                      ? "bg-red-500/20 text-red-300"
                      : "bg-green-500/20 text-green-300"
                  }`}
                >
                  {settings.use_real_data ? "MODO PRODUÇÃO" : "MODO DEMONSTRAÇÃO"}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-fg-1">
              {settings.use_real_data ? (
                <>
                  <span className="font-semibold">Coletando métricas REAIS</span> via Docker, Mininet, OpenFlow, etc.
                  <br />
                  <span className="text-fg-2">
                    Experimentos usarão dados reais da infraestrutura configurada.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-semibold">Gerando dados SINTÉTICOS</span> aleatórios para demonstração/testes.
                  <br />
                  <span className="text-fg-2">
                    Ideal para desenvolvimento, demos e testes sem infraestrutura real.
                  </span>
                </>
              )}
            </div>
          </div>
          <Button
            variant={settings.use_real_data ? "danger" : "primary"}
            disabled={updating}
            className="h-12 min-w-[140px] text-sm font-bold"
            onClick={() => updateSetting({ use_real_data: !settings.use_real_data })}
          >
            {updating ? "Aguarde..." : settings.use_real_data ? "◀ Usar Sintético" : "Usar Real ▶"}
          </Button>
        </div>

        {/* Informações sobre Coleta Real */}
        {settings.use_real_data && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2.5">
            <div className="mb-1 text-[10px] font-semibold text-yellow-400">
              ⚠️ Requisitos para Coleta Real
            </div>
            <ul className="ml-3 space-y-0.5 text-[9px] text-yellow-300/80 list-disc">
              <li>Containers Docker com nós da topologia (hosts/switches/controllers)</li>
              <li>Acesso SSH ou Docker exec para comandos de monitoramento</li>
              <li>OpenFlow ativo (para métricas de control/dataplane)</li>
              <li>Variáveis de ambiente configuradas (mgmt_ip, container_name, etc)</li>
            </ul>
            <div className="mt-2 text-[9px] text-yellow-200/60">
              Se a infraestrutura não estiver disponível, a coleta retornará dados vazios ou erro.
            </div>
          </div>
        )}

        {/* Intervalo de Coleta */}
        <div className="flex items-center gap-3 rounded-lg border border-border-0/40 bg-bg-1/40 p-3">
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium text-fg-0">Intervalo de Auto-Coleta</div>
            <div className="text-[10px] text-fg-1">
              Backend coleta métricas automaticamente a cada{" "}
              <span className="font-mono font-semibold text-accent-ok">{settings.collect_interval_sec}s</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={60}
              step={1}
              value={settings.collect_interval_sec}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (val > 0 && val <= 60) {
                  updateSetting({ collect_interval_sec: val });
                }
              }}
              disabled={updating}
              className="h-7 w-16 rounded-lg border border-border-0/60 bg-bg-1 px-2 text-center text-[11px] text-fg-0 focus:border-accent-ok/60 focus:outline-none focus:ring-1 focus:ring-accent-ok/30 disabled:opacity-50"
            />
            <span className="text-[10px] text-fg-2">segundos</span>
          </div>
        </div>

        {/* Documentação */}
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
          <div className="mb-1 text-[10px] font-semibold text-blue-300">📘 Como funciona</div>
          <div className="space-y-1 text-[9px] text-blue-200/70">
            <div>
              <span className="font-semibold text-blue-200">Sintético:</span> Gera valores aleatórios para todas
              as métricas (latência, throughput, loss, etc). Útil para testar o sistema sem infraestrutura.
            </div>
            <div>
              <span className="font-semibold text-blue-200">Real:</span> Executa comandos como{" "}
              <code className="rounded bg-blue-400/10 px-1 font-mono text-[8px]">ping</code>,{" "}
              <code className="rounded bg-blue-400/10 px-1 font-mono text-[8px]">ss -s</code>,{" "}
              <code className="rounded bg-blue-400/10 px-1 font-mono text-[8px]">ovs-ofctl</code> nos containers
              da topologia para obter dados verdadeiros da rede SDN.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
