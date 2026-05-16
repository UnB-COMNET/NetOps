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
      const res = await fetch(`${API_BASE}/system/settings`, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemSettings = await res.json();
      setSettings(data);
    } catch (err: any) {
      console.error("[DataModeToggle] Error:", err);
      setError(err.message ?? "Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = async () => {
    if (!settings) return;
    try {
      setUpdating(true);
      setError(null);
      const res = await fetch(`${API_BASE}/system/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_real_data: !settings.use_real_data }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SystemSettings = await res.json();
      setSettings(data);
    } catch (err: any) {
      setError(err.message ?? "Erro ao atualizar");
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    const interval = setInterval(fetchSettings, 10000); // Refresh a cada 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-border-0/60 bg-bg-2/10 p-3">
        <div className="text-[11px] text-fg-1">Carregando...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-lg border border-accent-danger/40 bg-accent-danger/10 p-3">
        <div className="text-[11px] font-semibold text-accent-danger">Erro ao carregar configurações</div>
        <div className="text-[10px] text-accent-danger/80">{error}</div>
        <Button variant="ghost" className="mt-2 h-6 text-[10px]" onClick={fetchSettings}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const isReal = settings.use_real_data;

  return (
    <div className="space-y-3">
      {/* Toggle Simplificado e Direto */}
      <div className={`rounded-lg border-2 p-4 transition-all ${
        isReal 
          ? "border-red-500/60 bg-gradient-to-br from-red-500/10 to-orange-500/10" 
          : "border-green-500/60 bg-gradient-to-br from-green-500/10 to-blue-500/10"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-4xl">{isReal ? "🔴" : "🟢"}</div>
            <div>
              <div className="text-lg font-bold text-fg-0">
                {isReal ? "Modo REAL" : "Modo SINTÉTICO"}
              </div>
              <div className="text-[11px] text-fg-1">
                {isReal ? "Coletando dados dos containers Docker" : "Gerando dados aleatórios para demo"}
              </div>
            </div>
          </div>
          <Button
            variant={isReal ? "danger" : "primary"}
            disabled={updating}
            className="h-12 min-w-[180px] text-base font-bold"
            onClick={toggleMode}
          >
            {updating ? "Alterando..." : isReal ? "Voltar para Sintético" : "Ativar Dados Reais"}
          </Button>
        </div>
        
        {error && (
          <div className="mt-3 rounded border border-accent-danger/40 bg-accent-danger/10 p-2 text-[10px] text-accent-danger">
            {error}
          </div>
        )}
      </div>

      {/* Aviso quando em modo real */}
      {isReal && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-yellow-400">
            <span>⚠️</span>
            <span>Requisitos para coleta real</span>
          </div>
          <ul className="ml-5 space-y-0.5 text-[10px] text-yellow-300/80 list-disc">
            <li>Containers Docker rodando (h1, h2, s1, c1)</li>
            <li>IPs configurados corretamente no platform_config.json</li>
            <li>Acesso via Docker exec aos containers</li>
          </ul>
        </div>
      )}

      {/* Informação sobre como funciona */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
        <div className="mb-1.5 text-[11px] font-semibold text-blue-300">ℹ️ Como funciona</div>
        <div className="space-y-1.5 text-[10px] text-blue-200/70">
          <div>
            <span className="font-semibold text-blue-200">Sintético:</span> Gera valores aleatórios.
            Útil para demos e testes sem infraestrutura.
          </div>
          <div>
            <span className="font-semibold text-blue-200">Real:</span> Executa comandos (ping, ss, ovs-ofctl)
            nos containers para obter métricas verdadeiras da rede SDN.
          </div>
        </div>
      </div>
    </div>
  );
}
