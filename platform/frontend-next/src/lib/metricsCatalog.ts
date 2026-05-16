// ──────────────────────────────────────────────────────────────────────────────
// metricsCatalog.ts — Catálogo completo de métricas espelhando o backend.
// Cada entrada corresponde a uma MetricDefinition do catalog Python.
// Camadas frontend (L0-L7, Control Plane, Dataplane) mapeiam as camadas
// backend (service, physical, link, network, transport, session,
//          presentation, application, control, dataplane).
// ──────────────────────────────────────────────────────────────────────────────

export type EntityKind = "switch" | "host" | "controller";

export type MetricCategory = "Saúde" | "Capacidade" | "Erros" | "Performance";
export type MetricType = "Gauge" | "Counter";

export type MetricLayer =
  | "L0"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "Control Plane"
  | "Dataplane";

export type MetricKind = "bool" | "number";
export type MetricDimension = "node" | "interface";

export type MetricSpec = {
  key: string;
  name: string;
  description?: string;
  layer: MetricLayer;
  category: MetricCategory;
  type: MetricType;
  kind: MetricKind;
  unit?: string;
  dimension: MetricDimension;
  entityKinds: EntityKind[];
  sim: { initial: number; step: number; min: number; max: number };
};

export const LAYERS: MetricLayer[] = [
  "L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7",
  "Control Plane", "Dataplane",
];

export const CATEGORIES: MetricCategory[] = ["Saúde", "Capacidade", "Erros", "Performance"];
export const TYPES: MetricType[] = ["Gauge", "Counter"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function g(
  key: string,
  name: string,
  layer: MetricLayer,
  category: MetricCategory,
  unit: string,
  entityKinds: EntityKind[],
  sim: MetricSpec["sim"],
  type: MetricType = "Gauge",
  kind: MetricKind = "number",
  dimension: MetricDimension = "node",
  description?: string,
): MetricSpec {
  return { key, name, description, layer, category, type, kind, unit, dimension, entityKinds, sim };
}

const SW: EntityKind[] = ["switch"];
const HOST: EntityKind[] = ["host"];
const CTRL: EntityKind[] = ["controller"];
const SW_HOST: EntityKind[] = ["switch", "host"];
const HOST_CTRL: EntityKind[] = ["host", "controller"];
const SW_HOST_CTRL: EntityKind[] = ["switch", "host", "controller"];

// ──────────────────────────────────────────────────────────────────────────────
// L0 — Service / User Experience (E2E) — backend layer: "service"
// ──────────────────────────────────────────────────────────────────────────────
const L0: MetricSpec[] = [
  g("e2e_path_availability_pct","e2e_path_availability_pct","L0","Saúde","%",HOST,{initial:99.5,step:0.2,min:0,max:100}),
  g("e2e_latency_ms_p50","e2e_latency_ms_p50","L0","Performance","ms",HOST,{initial:5,step:1,min:0,max:500}),
  g("e2e_latency_ms_p95","e2e_latency_ms_p95","L0","Performance","ms",HOST,{initial:15,step:3,min:0,max:1000}),
  g("e2e_latency_ms_p99","e2e_latency_ms_p99","L0","Performance","ms",HOST,{initial:30,step:5,min:0,max:2000}),
  g("e2e_jitter_ms_p95","e2e_jitter_ms_p95","L0","Performance","ms",HOST,{initial:2,step:0.5,min:0,max:100}),
  g("e2e_loss_pct","e2e_loss_pct","L0","Erros","%",HOST,{initial:0.1,step:0.05,min:0,max:100}),
  g("path_changes_total","path_changes_total","L0","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("mttd_sec","mttd_sec","L0","Performance","s",HOST,{initial:30,step:10,min:0,max:3600}),
  g("mttr_sec","mttr_sec","L0","Performance","s",HOST,{initial:120,step:30,min:0,max:86400}),
  g("worst_path_score","worst_path_score","L0","Performance","",HOST,{initial:0,step:0.1,min:0,max:100}),
  g("interface_util_p95_pct","interface_util_p95_pct","L0","Capacidade","%",SW,{initial:40,step:5,min:0,max:100},"Gauge","number","interface"),
  g("interface_headroom_pct","interface_headroom_pct","L0","Capacidade","%",SW,{initial:60,step:5,min:0,max:100},"Gauge","number","interface"),
  g("queue_depth","queue_depth","L0","Capacidade","count",SW,{initial:10,step:5,min:0,max:10000}),
  g("buffer_occupancy_pct","buffer_occupancy_pct","L0","Capacidade","%",SW,{initial:20,step:5,min:0,max:100}),
  g("ecn_marks_total","ecn_marks_total","L0","Erros","count",SW,{initial:0,step:10,min:0,max:1000000},"Counter"),
  g("elephant_flows_total","elephant_flows_total","L0","Capacidade","count",SW_HOST,{initial:2,step:1,min:0,max:10000},"Counter"),
  g("mice_flows_total","mice_flows_total","L0","Capacidade","count",SW_HOST,{initial:100,step:50,min:0,max:1000000},"Counter"),
  g("hotspot_score","hotspot_score","L0","Performance","",SW,{initial:0,step:0.1,min:0,max:100}),
  g("slo_error_budget_remaining_pct","slo_error_budget_remaining_pct","L0","Saúde","%",SW_HOST_CTRL,{initial:99,step:0.5,min:0,max:100}),
  g("incident_rate","incident_rate","L0","Erros","count/s",SW_HOST_CTRL,{initial:0,step:0.01,min:0,max:100}),
  g("flap_storm_events_total","flap_storm_events_total","L0","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter","number","interface"),
  g("config_drift_score","config_drift_score","L0","Saúde","",SW_HOST_CTRL,{initial:0,step:0.1,min:0,max:100}),
  g("firewall_denies_total","firewall_denies_total","L0","Erros","count",SW,{initial:0,step:5,min:0,max:10000000},"Counter"),
  g("scan_spikes_total","scan_spikes_total","L0","Erros","count",SW_HOST,{initial:0,step:2,min:0,max:1000000},"Counter"),
  g("ddos_syn_rate_pps","ddos_syn_rate_pps","L0","Erros","pps",SW_HOST,{initial:0,step:100,min:0,max:1000000}),
  g("ddos_udp_flood_pps","ddos_udp_flood_pps","L0","Erros","pps",SW_HOST,{initial:0,step:100,min:0,max:1000000}),
  g("abnormal_pps","abnormal_pps","L0","Erros","pps",SW,{initial:0,step:10,min:0,max:100000},"Gauge","number","interface"),
  g("anomaly_new_asns_total","anomaly_new_asns_total","L0","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("anomaly_new_countries_total","anomaly_new_countries_total","L0","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("anomaly_new_services_total","anomaly_new_services_total","L0","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("anomaly_new_ports_total","anomaly_new_ports_total","L0","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("auth_failures_total","auth_failures_total","L0","Erros","count",SW_HOST_CTRL,{initial:0,step:2,min:0,max:1000000},"Counter"),
  g("cert_errors_total","cert_errors_total","L0","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
];

// ──────────────────────────────────────────────────────────────────────────────
// L1 — Physical — backend layer: "physical"
// ──────────────────────────────────────────────────────────────────────────────
const L1: MetricSpec[] = [
  g("if_link_up","if_link_up","L1","Saúde","bool",SW_HOST,{initial:1,step:1,min:0,max:1},"Gauge","bool","interface"),
  g("if_flaps_total","if_flaps_total","L1","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter","number","interface"),
  g("if_speed_mbps","if_speed_mbps","L1","Capacidade","Mbps",SW_HOST,{initial:1000,step:0,min:10,max:400000},"Gauge","number","interface"),
  g("if_duplex_mismatch","if_duplex_mismatch","L1","Erros","bool",SW,{initial:0,step:1,min:0,max:1},"Gauge","bool","interface"),
  g("if_in_bps","if_in_bps","L1","Performance","bps",SW_HOST,{initial:100000000,step:10000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_out_bps","if_out_bps","L1","Performance","bps",SW_HOST,{initial:80000000,step:8000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_in_bps_p95","if_in_bps_p95","L1","Capacidade","bps",SW_HOST,{initial:200000000,step:20000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_in_bps_p99","if_in_bps_p99","L1","Capacidade","bps",SW_HOST,{initial:300000000,step:30000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_out_bps_p95","if_out_bps_p95","L1","Capacidade","bps",SW_HOST,{initial:150000000,step:10000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_out_bps_p99","if_out_bps_p99","L1","Capacidade","bps",SW_HOST,{initial:250000000,step:20000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("if_errors","if_errors","L1","Erros","count",SW_HOST,{initial:0,step:6,min:0,max:5000},"Counter","number","interface"),
  g("if_discards","if_discards","L1","Erros","count",SW_HOST,{initial:0,step:3,min:0,max:5000},"Counter","number","interface"),
  g("if_crc_errors","if_crc_errors","L1","Erros","frames",SW,{initial:0,step:3,min:0,max:10000},"Counter","number","interface"),
  g("if_fcs_errors_total","if_fcs_errors_total","L1","Erros","count",SW,{initial:0,step:2,min:0,max:10000},"Counter","number","interface"),
  g("if_alignment_errors_total","if_alignment_errors_total","L1","Erros","count",SW,{initial:0,step:1,min:0,max:5000},"Counter","number","interface"),
  g("if_symbol_errors_total","if_symbol_errors_total","L1","Erros","count",SW,{initial:0,step:1,min:0,max:5000},"Counter","number","interface"),
  g("if_physical_drops_total","if_physical_drops_total","L1","Erros","count",SW,{initial:0,step:2,min:0,max:100000},"Counter","number","interface"),
  g("if_optic_rx_dbm","if_optic_rx_dbm","L1","Saúde","dBm",SW,{initial:-3.2,step:0.25,min:-18,max:1},"Gauge","number","interface"),
  g("if_optic_tx_dbm","if_optic_tx_dbm","L1","Saúde","dBm",SW,{initial:-2.1,step:0.2,min:-12,max:2},"Gauge","number","interface"),
  g("if_optic_osnr_db","if_optic_osnr_db","L1","Saúde","dB",SW,{initial:20,step:1,min:0,max:40},"Gauge","number","interface"),
  g("if_optic_bias_ma","if_optic_bias_ma","L1","Saúde","mA",SW,{initial:40,step:2,min:0,max:120},"Gauge","number","interface"),
  g("if_optic_temp_c","if_optic_temp_c","L1","Saúde","C",SW,{initial:35,step:1,min:-10,max:80},"Gauge","number","interface"),
  g("if_optic_threshold_violations_total","if_optic_threshold_violations_total","L1","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter","number","interface"),
  g("if_temp_c","if_temp_c","L1","Saúde","C",SW,{initial:40,step:2,min:10,max:95},"Gauge","number","interface"),
  g("if_mtu_effective_bytes","if_mtu_effective_bytes","L1","Saúde","bytes",SW_HOST,{initial:1500,step:0,min:68,max:9216},"Gauge","number","interface"),
  g("poe_power_w","poe_power_w","L1","Capacidade","W",SW,{initial:15,step:1,min:0,max:90},"Gauge","number","interface"),
  g("poe_events_total","poe_events_total","L1","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter","number","interface"),
  g("poe_budget_w","poe_budget_w","L1","Capacidade","W",SW,{initial:370,step:0,min:0,max:1440}),
  g("if_in_util_pct","if_in_util_pct","L1","Performance","%",SW_HOST,{initial:20,step:5,min:0,max:100},"Gauge","number","interface"),
  g("if_out_util_pct","if_out_util_pct","L1","Performance","%",SW_HOST,{initial:15,step:5,min:0,max:100},"Gauge","number","interface"),
];

// ──────────────────────────────────────────────────────────────────────────────
// L2 — Link — backend layer: "link"
// ──────────────────────────────────────────────────────────────────────────────
const L2: MetricSpec[] = [
  g("mac_table_size","mac_table_size","L2","Capacidade","entries",SW,{initial:420,step:12,min:0,max:16000}),
  g("mac_churn_rate","mac_churn_rate","L2","Erros","count/s",SW,{initial:0,step:0.5,min:0,max:10000}),
  g("mac_moves_total","mac_moves_total","L2","Erros","count",SW,{initial:0,step:5,min:0,max:1000000},"Counter"),
  g("stp_root_changes_total","stp_root_changes_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("stp_topology_changes_total","stp_topology_changes_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("stp_blocked_ports","stp_blocked_ports","L2","Saúde","count",SW,{initial:0,step:1,min:0,max:64}),
  g("lacp_members_up","lacp_members_up","L2","Saúde","count",SW,{initial:4,step:0,min:0,max:32}),
  g("lacp_members_down","lacp_members_down","L2","Erros","count",SW,{initial:0,step:1,min:0,max:32}),
  g("lacp_imbalance_pct","lacp_imbalance_pct","L2","Performance","%",SW,{initial:5,step:2,min:0,max:100}),
  g("lacp_renegotiations_total","lacp_renegotiations_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("vlan_active_count","vlan_active_count","L2","Capacidade","vlans",SW,{initial:4,step:1.2,min:0,max:4094}),
  g("vlan_allowed_mismatch_total","vlan_allowed_mismatch_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("vlan_native_mismatch_total","vlan_native_mismatch_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("bum_rate_pps","bum_rate_pps","L2","Capacidade","pps",SW,{initial:100,step:20,min:0,max:1000000}),
  g("bum_peak_pps","bum_peak_pps","L2","Capacidade","pps",SW,{initial:500,step:50,min:0,max:10000000}),
  g("arp_cache_util_pct","arp_cache_util_pct","L2","Capacidade","%",SW_HOST,{initial:20,step:2,min:0,max:100}),
  g("arp_miss_rate","arp_miss_rate","L2","Performance","count/s",SW_HOST,{initial:1,step:0.5,min:0,max:1000}),
  g("arp_duplicates_total","arp_duplicates_total","L2","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("arp_gratuitous_spikes_total","arp_gratuitous_spikes_total","L2","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("nd_cache_util_pct","nd_cache_util_pct","L2","Capacidade","%",SW_HOST,{initial:10,step:2,min:0,max:100}),
  g("nd_miss_rate","nd_miss_rate","L2","Performance","count/s",SW_HOST,{initial:0.5,step:0.2,min:0,max:1000}),
  g("nd_duplicates_total","nd_duplicates_total","L2","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("lldp_neighbors_expected_pct","lldp_neighbors_expected_pct","L2","Saúde","%",SW,{initial:100,step:5,min:0,max:100}),
  g("lldp_drift_total","lldp_drift_total","L2","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("microburst_queue_occupancy_pct_peak","microburst_queue_occupancy_pct_peak","L2","Capacidade","%",SW,{initial:30,step:5,min:0,max:100},"Gauge","number","interface"),
  g("link_util_pct","link_util_pct","L2","Performance","%",SW_HOST,{initial:22,step:6,min:0,max:100},"Gauge","number","interface"),
  g("link_loss_pct","link_loss_pct","L2","Erros","%",SW_HOST,{initial:0,step:0.1,min:0,max:100},"Gauge","number","interface"),
  g("link_jitter_ms","link_jitter_ms","L2","Performance","ms",SW_HOST,{initial:0.5,step:0.2,min:0,max:100},"Gauge","number","interface"),
  g("queue_occupancy_pct","queue_occupancy_pct","L2","Capacidade","%",SW,{initial:10,step:3,min:0,max:100},"Gauge","number","interface"),
  g("queue_drops","queue_drops","L2","Erros","count",SW,{initial:0,step:5,min:0,max:100000},"Counter","number","interface"),
  g("ecn_marked_pct","ecn_marked_pct","L2","Capacidade","%",SW,{initial:0.5,step:0.1,min:0,max:100},"Gauge","number","interface"),
  g("link_rx_bytes","link_rx_bytes","L2","Performance","bytes",SW_HOST,{initial:1000000,step:100000,min:0,max:1000000000000},"Counter","number","interface"),
  g("link_tx_bytes","link_tx_bytes","L2","Performance","bytes",SW_HOST,{initial:800000,step:80000,min:0,max:1000000000000},"Counter","number","interface"),
  g("link_rx_packets","link_rx_packets","L2","Performance","pkts",SW_HOST,{initial:5000,step:500,min:0,max:10000000000},"Counter","number","interface"),
  g("link_tx_packets","link_tx_packets","L2","Performance","pkts",SW_HOST,{initial:4000,step:400,min:0,max:10000000000},"Counter","number","interface"),
  g("link_rx_errors","link_rx_errors","L2","Erros","count",SW_HOST,{initial:0,step:2,min:0,max:10000},"Counter","number","interface"),
  g("link_tx_errors","link_tx_errors","L2","Erros","count",SW_HOST,{initial:0,step:2,min:0,max:10000},"Counter","number","interface"),
];

// ──────────────────────────────────────────────────────────────────────────────
// L3 — Network — backend layer: "network"
// ──────────────────────────────────────────────────────────────────────────────
const L3: MetricSpec[] = [
  g("prefix_reachability_pct","prefix_reachability_pct","L3","Saúde","%",SW_HOST,{initial:99,step:0.5,min:0,max:100}),
  g("routing_convergence_ms","routing_convergence_ms","L3","Performance","ms",SW,{initial:50,step:10,min:0,max:30000}),
  g("route_count","route_count","L3","Capacidade","routes",SW,{initial:64,step:2,min:0,max:500000}),
  g("route_churn_rate","route_churn_rate","L3","Erros","count/s",SW,{initial:0,step:0.2,min:0,max:10000}),
  g("bgp_session_up","bgp_session_up","L3","Saúde","bool",SW,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("bgp_session_flaps_total","bgp_session_flaps_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("bgp_updates_total","bgp_updates_total","L3","Performance","count",SW,{initial:100,step:20,min:0,max:100000000},"Counter"),
  g("bgp_withdraws_total","bgp_withdraws_total","L3","Erros","count",SW,{initial:0,step:5,min:0,max:1000000},"Counter"),
  g("bgp_prefix_limit_hits_total","bgp_prefix_limit_hits_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("bgp_as_path_changes_total","bgp_as_path_changes_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("ospf_session_up","ospf_session_up","L3","Saúde","bool",SW,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("ospf_flaps_total","ospf_flaps_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("isis_session_up","isis_session_up","L3","Saúde","bool",SW,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("isis_flaps_total","isis_flaps_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("icmp_unreachable_total","icmp_unreachable_total","L3","Erros","count",SW_HOST,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("icmp_frag_needed_total","icmp_frag_needed_total","L3","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("ip_fragments_total","ip_fragments_total","L3","Erros","count",SW_HOST,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("ip_fragment_drops_total","ip_fragment_drops_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:50000},"Counter"),
  g("dscp_packets_total","dscp_packets_total","L3","Performance","count",SW,{initial:1000,step:100,min:0,max:1000000000},"Counter"),
  g("dscp_remark_events_total","dscp_remark_events_total","L3","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("acl_drops_total","acl_drops_total","L3","Erros","count",SW,{initial:0,step:5,min:0,max:1000000},"Counter"),
  g("tunnel_up","tunnel_up","L3","Saúde","bool",SW_HOST,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("tunnel_keepalive_loss_total","tunnel_keepalive_loss_total","L3","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("tunnel_encap_errors_total","tunnel_encap_errors_total","L3","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("tunnel_decap_errors_total","tunnel_decap_errors_total","L3","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("vxlan_vni_mapping_ok","vxlan_vni_mapping_ok","L3","Saúde","bool",SW,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("latency_ms","latency_ms","L3","Performance","ms",SW_HOST,{initial:2,step:0.5,min:0,max:500}),
  g("packet_loss_pct","packet_loss_pct","L3","Erros","%",SW_HOST,{initial:0,step:0.1,min:0,max:100}),
  g("jitter_ms","jitter_ms","L3","Performance","ms",SW_HOST,{initial:0.3,step:0.1,min:0,max:100}),
  g("ttl_expired","ttl_expired","L3","Erros","count",SW_HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("routes_count","routes_count","L3","Capacidade","routes",SW_HOST,{initial:10,step:2,min:0,max:500000}),
  g("arp_entries","arp_entries","L3","Capacidade","entries",SW_HOST,{initial:20,step:3,min:0,max:4096}),
  g("host_ping_ok","host_ping_ok","L3","Saúde","bool",HOST,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("host_ping_latency_ms","host_ping_latency_ms","L3","Performance","ms",HOST,{initial:1,step:0.3,min:0,max:1000}),
];

// ──────────────────────────────────────────────────────────────────────────────
// L4 — Transport — backend layer: "transport"
// ──────────────────────────────────────────────────────────────────────────────
const L4: MetricSpec[] = [
  g("tcp_retrans_pct","tcp_retrans_pct","L4","Erros","%",HOST,{initial:0.8,step:0.5,min:0,max:100}),
  g("tcp_retrans_total","tcp_retrans_total","L4","Erros","count",HOST,{initial:0,step:12,min:0,max:1000000},"Counter"),
  g("tcp_fast_retrans_total","tcp_fast_retrans_total","L4","Erros","count",HOST,{initial:0,step:5,min:0,max:1000000},"Counter"),
  g("tcp_dup_acks_total","tcp_dup_acks_total","L4","Erros","count",HOST,{initial:0,step:8,min:0,max:1000000},"Counter"),
  g("tcp_handshake_success_pct","tcp_handshake_success_pct","L4","Saúde","%",HOST,{initial:99,step:0.5,min:0,max:100}),
  g("tcp_handshake_latency_ms","tcp_handshake_latency_ms","L4","Performance","ms",HOST,{initial:5,step:1,min:0,max:1000}),
  g("tcp_resets_total","tcp_resets_total","L4","Erros","count",HOST,{initial:0,step:3,min:0,max:1000000},"Counter"),
  g("tcp_out_of_order_total","tcp_out_of_order_total","L4","Erros","count",HOST,{initial:0,step:4,min:0,max:1000000},"Counter"),
  g("tcp_zero_window_total","tcp_zero_window_total","L4","Erros","count",HOST,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("tcp_window_scaling_anomalies_total","tcp_window_scaling_anomalies_total","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("udp_loss_pct","udp_loss_pct","L4","Erros","%",HOST,{initial:0.2,step:0.2,min:0,max:100}),
  g("udp_jitter_ms","udp_jitter_ms","L4","Performance","ms",HOST,{initial:0.5,step:0.2,min:0,max:100}),
  g("nat_table_util_pct","nat_table_util_pct","L4","Capacidade","%",SW,{initial:20,step:5,min:0,max:100}),
  g("nat_port_exhaustion_events_total","nat_port_exhaustion_events_total","L4","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("nat_translation_failures_total","nat_translation_failures_total","L4","Erros","count",SW,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("lb_healthcheck_success_pct","lb_healthcheck_success_pct","L4","Saúde","%",HOST_CTRL,{initial:100,step:1,min:0,max:100}),
  g("lb_connection_rate","lb_connection_rate","L4","Performance","count/s",HOST_CTRL,{initial:100,step:20,min:0,max:1000000}),
  g("lb_concurrent_connections","lb_concurrent_connections","L4","Capacidade","count",HOST_CTRL,{initial:200,step:30,min:0,max:1000000}),
  g("lb_backend_connect_errors_total","lb_backend_connect_errors_total","L4","Erros","count",HOST_CTRL,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("lb_backend_timeouts_total","lb_backend_timeouts_total","L4","Erros","count",HOST_CTRL,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("throughput_mbps","throughput_mbps","L4","Performance","Mbps",HOST,{initial:420,step:35,min:0,max:150000}),
  g("tcp_rtt_ms","tcp_rtt_ms","L4","Performance","ms",HOST,{initial:18,step:2.4,min:1,max:300}),
  g("ss_sockets_total","ss_sockets_total","L4","Capacidade","count",HOST,{initial:8,step:2,min:0,max:100000}),
  g("ss_tcp_states","ss_tcp_states","L4","Capacidade","count",HOST,{initial:5,step:1,min:0,max:100000}),
  g("ss_tcp_sockets_total","ss_tcp_sockets_total","L4","Capacidade","count",HOST,{initial:4,step:1,min:0,max:100000}),
  g("ss_udp_sockets_total","ss_udp_sockets_total","L4","Capacidade","count",HOST,{initial:2,step:1,min:0,max:10000}),
  g("ss_raw_sockets_total","ss_raw_sockets_total","L4","Capacidade","count",HOST,{initial:0,step:0,min:0,max:100}),
  g("ss_inet_sockets_total","ss_inet_sockets_total","L4","Capacidade","count",HOST,{initial:6,step:1,min:0,max:100000}),
  g("ss_frag_sockets_total","ss_frag_sockets_total","L4","Capacidade","count",HOST,{initial:0,step:0,min:0,max:100}),
  g("transport_tcp_in_segs","transport_tcp_in_segs","L4","Performance","count",HOST,{initial:500,step:50,min:0,max:10000000000},"Counter"),
  g("transport_tcp_out_segs","transport_tcp_out_segs","L4","Performance","count",HOST,{initial:480,step:48,min:0,max:10000000000},"Counter"),
  g("transport_tcp_retrans_segs","transport_tcp_retrans_segs","L4","Erros","count",HOST,{initial:2,step:1,min:0,max:1000000},"Counter"),
  g("transport_udp_in_datagrams","transport_udp_in_datagrams","L4","Performance","count",HOST,{initial:100,step:20,min:0,max:10000000000},"Counter"),
  g("transport_udp_out_datagrams","transport_udp_out_datagrams","L4","Performance","count",HOST,{initial:90,step:18,min:0,max:10000000000},"Counter"),
  g("transport_udp_in_errors","transport_udp_in_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:1000000},"Counter"),
  g("snmp_ip_in_receives","snmp_ip_in_receives","L4","Performance","count",HOST,{initial:1000,step:100,min:0,max:10000000000},"Counter"),
  g("snmp_ip_in_hdr_errors","snmp_ip_in_hdr_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_in_addr_errors","snmp_ip_in_addr_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_forw_datagrams","snmp_ip_forw_datagrams","L4","Performance","count",HOST,{initial:10,step:2,min:0,max:1000000000},"Counter"),
  g("snmp_ip_in_unknown_protos","snmp_ip_in_unknown_protos","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_in_discards","snmp_ip_in_discards","L4","Erros","count",HOST,{initial:0,step:2,min:0,max:1000000},"Counter"),
  g("snmp_ip_in_delivers","snmp_ip_in_delivers","L4","Performance","count",HOST,{initial:800,step:80,min:0,max:10000000000},"Counter"),
  g("snmp_ip_out_requests","snmp_ip_out_requests","L4","Performance","count",HOST,{initial:900,step:90,min:0,max:10000000000},"Counter"),
  g("snmp_ip_out_discards","snmp_ip_out_discards","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_out_no_routes","snmp_ip_out_no_routes","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("snmp_ip_reasm_reqds","snmp_ip_reasm_reqds","L4","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_reasm_oks","snmp_ip_reasm_oks","L4","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_reasm_fails","snmp_ip_reasm_fails","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("snmp_ip_frag_oks","snmp_ip_frag_oks","L4","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_frag_fails","snmp_ip_frag_fails","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("snmp_ip_frag_creates","snmp_ip_frag_creates","L4","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_ip_out_transmits","snmp_ip_out_transmits","L4","Performance","count",HOST,{initial:900,step:90,min:0,max:10000000000},"Counter"),
  g("snmp_icmp_in_msgs","snmp_icmp_in_msgs","L4","Performance","count",HOST,{initial:5,step:2,min:0,max:10000000},"Counter"),
  g("snmp_icmp_out_msgs","snmp_icmp_out_msgs","L4","Performance","count",HOST,{initial:5,step:2,min:0,max:10000000},"Counter"),
  g("snmp_icmp_in_errors","snmp_icmp_in_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_icmp_out_errors","snmp_icmp_out_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_icmp_in_dest_unreachs","snmp_icmp_in_dest_unreachs","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_icmp_out_dest_unreachs","snmp_icmp_out_dest_unreachs","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_icmp_in_time_excds","snmp_icmp_in_time_excds","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("snmp_icmp_out_time_excds","snmp_icmp_out_time_excds","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("snmp_icmp_in_echo_reqs","snmp_icmp_in_echo_reqs","L4","Performance","count",HOST,{initial:2,step:1,min:0,max:1000000},"Counter"),
  g("snmp_icmp_out_echo_reps","snmp_icmp_out_echo_reps","L4","Performance","count",HOST,{initial:2,step:1,min:0,max:1000000},"Counter"),
  g("snmp_tcp_active_opens","snmp_tcp_active_opens","L4","Performance","count",HOST,{initial:10,step:3,min:0,max:10000000},"Counter"),
  g("snmp_tcp_passive_opens","snmp_tcp_passive_opens","L4","Performance","count",HOST,{initial:5,step:2,min:0,max:10000000},"Counter"),
  g("snmp_tcp_attempt_fails","snmp_tcp_attempt_fails","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_tcp_estab_resets","snmp_tcp_estab_resets","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_tcp_curr_estab","snmp_tcp_curr_estab","L4","Capacidade","count",HOST,{initial:3,step:1,min:0,max:65535}),
  g("snmp_tcp_in_segs","snmp_tcp_in_segs","L4","Performance","count",HOST,{initial:300,step:30,min:0,max:10000000000},"Counter"),
  g("snmp_tcp_out_segs","snmp_tcp_out_segs","L4","Performance","count",HOST,{initial:280,step:28,min:0,max:10000000000},"Counter"),
  g("snmp_tcp_retrans_segs","snmp_tcp_retrans_segs","L4","Erros","count",HOST,{initial:2,step:1,min:0,max:1000000},"Counter"),
  g("snmp_tcp_in_errs","snmp_tcp_in_errs","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_tcp_out_rsts","snmp_tcp_out_rsts","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_tcp_in_csum_errors","snmp_tcp_in_csum_errors","L4","Erros","count",HOST,{initial:0,step:0,min:0,max:10000},"Counter"),
  g("snmp_udp_in_datagrams","snmp_udp_in_datagrams","L4","Performance","count",HOST,{initial:50,step:5,min:0,max:1000000000},"Counter"),
  g("snmp_udp_no_ports","snmp_udp_no_ports","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_udp_in_errors","snmp_udp_in_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_udp_out_datagrams","snmp_udp_out_datagrams","L4","Performance","count",HOST,{initial:45,step:5,min:0,max:1000000000},"Counter"),
  g("snmp_udp_rcvbuf_errors","snmp_udp_rcvbuf_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_udp_sndbuf_errors","snmp_udp_sndbuf_errors","L4","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_udp_in_csum_errors","snmp_udp_in_csum_errors","L4","Erros","count",HOST,{initial:0,step:0,min:0,max:10000},"Counter"),
  g("snmp_udp_ignored_multi","snmp_udp_ignored_multi","L4","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("snmp_udp_mem_errors","snmp_udp_mem_errors","L4","Erros","count",HOST,{initial:0,step:0,min:0,max:10000},"Counter"),
];

// ──────────────────────────────────────────────────────────────────────────────
// L5 — Session — backend layer: "session"
// ──────────────────────────────────────────────────────────────────────────────
const L5: MetricSpec[] = [
  g("tls_session_resumption_pct","tls_session_resumption_pct","L5","Performance","%",HOST,{initial:60,step:5,min:0,max:100}),
  g("tls_renegotiations_total","tls_renegotiations_total","L5","Performance","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("tls_handshake_failures_total","tls_handshake_failures_total","L5","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("vpn_sessions_active","vpn_sessions_active","L5","Capacidade","count",HOST_CTRL,{initial:10,step:5,min:0,max:100000}),
  g("vpn_session_establish_rate","vpn_session_establish_rate","L5","Performance","count/s",HOST_CTRL,{initial:2,step:0.5,min:0,max:1000}),
  g("vpn_session_failures_total","vpn_session_failures_total","L5","Erros","count",HOST_CTRL,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("aaa_auth_failures_total","aaa_auth_failures_total","L5","Erros","count",HOST_CTRL,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("session_idle_timeouts_total","session_idle_timeouts_total","L5","Performance","count",HOST,{initial:0,step:2,min:0,max:1000000},"Counter"),
  g("fw_state_table_util_pct","fw_state_table_util_pct","L5","Capacidade","%",SW,{initial:20,step:5,min:0,max:100}),
  g("fw_state_table_drops_total","fw_state_table_drops_total","L5","Erros","count",SW,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("tls_handshake_latency","tls_handshake_latency","L5","Performance","ms",HOST,{initial:24,step:4,min:1,max:800}),
  g("tls_handshake_fail_total","tls_handshake_fail_total","L5","Erros","fails",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("tls_handshake_ms","tls_handshake_ms","L5","Performance","ms",HOST,{initial:24,step:4,min:1,max:800}),
];

// ──────────────────────────────────────────────────────────────────────────────
// L6 — Presentation — backend layer: "presentation"
// ──────────────────────────────────────────────────────────────────────────────
const L6: MetricSpec[] = [
  g("tls_handshake_latency_ms_p95","tls_handshake_latency_ms_p95","L6","Performance","ms",HOST,{initial:80,step:15,min:0,max:2000}),
  g("tls_handshake_latency_ms_p99","tls_handshake_latency_ms_p99","L6","Performance","ms",HOST,{initial:150,step:30,min:0,max:5000}),
  g("tls_version_connections_total","tls_version_connections_total","L6","Performance","count",HOST,{initial:1000,step:100,min:0,max:1000000000},"Counter"),
  g("tls_cipher_connections_total","tls_cipher_connections_total","L6","Performance","count",HOST,{initial:800,step:80,min:0,max:1000000000},"Counter"),
  g("cert_expiry_days","cert_expiry_days","L6","Saúde","days",HOST,{initial:90,step:-0.1,min:0,max:825}),
  g("cert_validation_errors_total","cert_validation_errors_total","L6","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("cert_chain_errors_total","cert_chain_errors_total","L6","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("sni_mismatch_total","sni_mismatch_total","L6","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("compression_errors_total","compression_errors_total","L6","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("encoding_errors_total","encoding_errors_total","L6","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("http2_negotiation_success_pct","http2_negotiation_success_pct","L6","Saúde","%",HOST,{initial:95,step:1,min:0,max:100}),
  g("http3_quic_negotiation_success_pct","http3_quic_negotiation_success_pct","L6","Saúde","%",HOST,{initial:60,step:5,min:0,max:100}),
  g("quic_fallback_rate_pct","quic_fallback_rate_pct","L6","Performance","%",HOST,{initial:10,step:2,min:0,max:100}),
  g("cpu_pct","cpu_pct","L6","Saúde","%",HOST_CTRL,{initial:18,step:6,min:0,max:100}),
  g("ram_used_pct","ram_used_pct","L6","Saúde","%",HOST_CTRL,{initial:42,step:5,min:0,max:100}),
  g("app_latency_ms","app_latency_ms","L6","Performance","ms",HOST_CTRL,{initial:32,step:8,min:1,max:2000}),
  g("app_latency_ms_p95","app_latency_ms_p95","L6","Performance","ms",HOST_CTRL,{initial:85,step:18,min:1,max:6000}),
  g("http_responses_total","http_responses_total","L6","Performance","req",HOST,{initial:100000,step:4500,min:0,max:1000000000000},"Counter"),
  g("http_5xx_total","http_5xx_total","L6","Erros","req",HOST,{initial:0,step:2,min:0,max:1000000},"Counter"),
];

// ──────────────────────────────────────────────────────────────────────────────
// L7 — Application — backend layer: "application"
// ──────────────────────────────────────────────────────────────────────────────
const L7: MetricSpec[] = [
  g("app_rps","app_rps","L7","Performance","rps",HOST,{initial:200,step:30,min:0,max:1000000}),
  g("app_latency_ms_p99","app_latency_ms_p99","L7","Performance","ms",HOST,{initial:120,step:20,min:1,max:10000}),
  g("app_error_rate_pct","app_error_rate_pct","L7","Erros","%",HOST,{initial:0.5,step:0.2,min:0,max:100}),
  g("http_errors_total","http_errors_total","L7","Erros","count",HOST,{initial:0,step:5,min:0,max:1000000000},"Counter"),
  g("http_latency_ms","http_latency_ms","L7","Performance","ms",HOST,{initial:80,step:15,min:0,max:5000}),
  g("http_success_pct","http_success_pct","L7","Saúde","%",HOST,{initial:99,step:0.5,min:0,max:100}),
  g("http_ttfb_ms","http_ttfb_ms","L7","Performance","ms",HOST,{initial:30,step:5,min:0,max:2000}),
  g("http_ttlb_ms","http_ttlb_ms","L7","Performance","ms",HOST,{initial:100,step:15,min:0,max:5000}),
  g("http_payload_bytes_p95","http_payload_bytes_p95","L7","Capacidade","bytes",HOST,{initial:5000,step:500,min:0,max:10000000}),
  g("dns_qps","dns_qps","L7","Performance","qps",HOST,{initial:50,step:10,min:0,max:1000000}),
  g("dns_latency_ms","dns_latency_ms","L7","Performance","ms",HOST,{initial:8,step:2,min:0,max:1000}),
  g("dns_latency_ms_p95","dns_latency_ms_p95","L7","Performance","ms",HOST,{initial:20,step:5,min:0,max:2000}),
  g("dns_servfail_total","dns_servfail_total","L7","Erros","count",HOST,{initial:0,step:1,min:0,max:1000000},"Counter"),
  g("dns_nxdomain_total","dns_nxdomain_total","L7","Erros","count",HOST,{initial:0,step:2,min:0,max:1000000},"Counter"),
  g("dns_cache_hit_ratio_pct","dns_cache_hit_ratio_pct","L7","Performance","%",HOST,{initial:80,step:5,min:0,max:100}),
  g("dns_success_pct","dns_success_pct","L7","Saúde","%",HOST,{initial:99,step:0.5,min:0,max:100}),
  g("dns_ok","dns_ok","L7","Saúde","bool",HOST,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("dhcp_success_pct","dhcp_success_pct","L7","Saúde","%",HOST,{initial:99.9,step:0.05,min:0,max:100}),
  g("dhcp_dora_latency_ms","dhcp_dora_latency_ms","L7","Performance","ms",HOST,{initial:5,step:1,min:0,max:1000}),
  g("dhcp_pool_util_pct","dhcp_pool_util_pct","L7","Capacidade","%",HOST,{initial:40,step:5,min:0,max:100}),
  g("dhcp_conflicts_total","dhcp_conflicts_total","L7","Erros","count",HOST,{initial:0,step:1,min:0,max:10000},"Counter"),
  g("ntp_offset_ms","ntp_offset_ms","L7","Saúde","ms",HOST,{initial:0.5,step:0.1,min:-500,max:500}),
  g("ntp_drift_ppm","ntp_drift_ppm","L7","Performance","ppm",HOST,{initial:5,step:1,min:-500,max:500}),
  g("ntp_stratum_changes_total","ntp_stratum_changes_total","L7","Erros","count",HOST,{initial:0,step:1,min:0,max:1000},"Counter"),
  g("ntp_reachability_pct","ntp_reachability_pct","L7","Saúde","%",HOST,{initial:100,step:1,min:0,max:100}),
  g("grpc_status_total","grpc_status_total","L7","Performance","count",HOST,{initial:1000,step:100,min:0,max:1000000000},"Counter"),
  g("grpc_deadlines_exceeded_total","grpc_deadlines_exceeded_total","L7","Erros","count",HOST,{initial:0,step:2,min:0,max:100000},"Counter"),
  g("db_connection_errors_total","db_connection_errors_total","L7","Erros","count",HOST,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("db_query_latency_ms_p95","db_query_latency_ms_p95","L7","Performance","ms",HOST,{initial:10,step:2,min:0,max:10000}),
  g("dns_resolve_ms","dns_resolve_ms","L7","Performance","ms",HOST,{initial:6,step:1.2,min:0.2,max:250}),
  g("service_error_rate_pct","service_error_rate_pct","L7","Erros","%",HOST_CTRL,{initial:0.4,step:0.3,min:0,max:100}),
  g("e2e_path_availability","e2e_path_availability","L7","Saúde","bool",SW_HOST,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
];

// ──────────────────────────────────────────────────────────────────────────────
// Control Plane — backend layer: "control"
// ──────────────────────────────────────────────────────────────────────────────
const CONTROL_PLANE: MetricSpec[] = [
  g("controller_latency_ms","controller_latency_ms","Control Plane","Performance","ms",CTRL,{initial:8,step:2.2,min:0.2,max:800}),
  g("controller_conn_ok","controller_conn_ok","Control Plane","Saúde","bool",CTRL,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("controller_latency","controller_latency","Control Plane","Performance","ms",CTRL,{initial:8,step:2,min:0.2,max:800}),
  g("controller_heartbeat_up","controller_heartbeat_up","Control Plane","Saúde","bool",CTRL,{initial:1,step:1,min:0,max:1},"Gauge","bool"),
  g("of_channel_reconnects","of_channel_reconnects","Control Plane","Erros","count",CTRL,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("channel_reconnects_total","channel_reconnects_total","Control Plane","Erros","count",CTRL,{initial:0,step:1,min:0,max:100000},"Counter"),
  g("flows_installed","flows_installed","Control Plane","Performance","flows",CTRL,{initial:1200,step:80,min:0,max:1000000000},"Counter"),
  g("flows_removed","flows_removed","Control Plane","Performance","flows",CTRL,{initial:0,step:20,min:0,max:1000000000},"Counter"),
  g("socket_open_fds","socket_open_fds","Control Plane","Capacidade","fds",HOST_CTRL,{initial:220,step:20,min:0,max:200000}),
  g("docker_cpu_util_pct","docker_cpu_util_pct","Control Plane","Saúde","%",SW_HOST_CTRL,{initial:5,step:2,min:0,max:100}),
  g("docker_mem_util_pct","docker_mem_util_pct","Control Plane","Saúde","%",SW_HOST_CTRL,{initial:30,step:5,min:0,max:100}),
  g("docker_mem_used_bytes","docker_mem_used_bytes","Control Plane","Capacidade","bytes",SW_HOST_CTRL,{initial:50000000,step:1000000,min:0,max:10000000000}),
  g("docker_net_rx_bytes","docker_net_rx_bytes","Control Plane","Performance","bytes",SW_HOST_CTRL,{initial:1000000,step:100000,min:0,max:1000000000000},"Counter"),
  g("docker_net_tx_bytes","docker_net_tx_bytes","Control Plane","Performance","bytes",SW_HOST_CTRL,{initial:800000,step:80000,min:0,max:1000000000000},"Counter"),
  g("docker_block_read_bytes","docker_block_read_bytes","Control Plane","Performance","bytes",SW_HOST_CTRL,{initial:10000,step:1000,min:0,max:100000000000},"Counter"),
  g("docker_block_write_bytes","docker_block_write_bytes","Control Plane","Performance","bytes",SW_HOST_CTRL,{initial:5000,step:500,min:0,max:100000000000},"Counter"),
  g("cpu_util_pct","cpu_util_pct","Control Plane","Saúde","%",SW_HOST_CTRL,{initial:10,step:3,min:0,max:100}),
  g("mem_util_pct","mem_util_pct","Control Plane","Saúde","%",SW_HOST_CTRL,{initial:35,step:5,min:0,max:100}),
];

// ──────────────────────────────────────────────────────────────────────────────
// Dataplane — backend layer: "dataplane"
// ──────────────────────────────────────────────────────────────────────────────
const DATAPLANE: MetricSpec[] = [
  g("openflow_flow_packets","openflow_flow_packets","Dataplane","Performance","pkts",SW,{initial:100000,step:10000,min:0,max:1000000000000000},"Counter"),
  g("openflow_flow_bytes","openflow_flow_bytes","Dataplane","Performance","bytes",SW,{initial:10000000,step:1000000,min:0,max:1000000000000000},"Counter"),
  g("table_hits","table_hits","Dataplane","Performance","hits",SW,{initial:5500000,step:250000,min:0,max:1000000000000},"Counter"),
  g("table_hits_total","table_hits_total","Dataplane","Performance","hits",SW,{initial:5500000,step:250000,min:0,max:1000000000000},"Counter"),
  g("table_misses","table_misses","Dataplane","Erros","miss",SW,{initial:1200,step:180,min:0,max:1000000000},"Counter"),
  g("table_miss_total","table_miss_total","Dataplane","Erros","miss",SW,{initial:1200,step:180,min:0,max:1000000000},"Counter"),
  g("port_rx_pkts","port_rx_pkts","Dataplane","Performance","pkts",SW,{initial:100000,step:10000,min:0,max:1000000000000},"Counter","number","interface"),
  g("port_tx_pkts","port_tx_pkts","Dataplane","Performance","pkts",SW,{initial:90000,step:9000,min:0,max:1000000000000},"Counter","number","interface"),
  g("port_rx_drops","port_rx_drops","Dataplane","Erros","pkts",SW,{initial:0,step:8,min:0,max:100000},"Counter","number","interface"),
  g("port_tx_drops","port_tx_drops","Dataplane","Erros","pkts",SW,{initial:0,step:6,min:0,max:100000},"Counter","number","interface"),
  g("flow_packets","flow_packets","Dataplane","Performance","pkts",SW,{initial:240000000,step:2200000,min:0,max:1000000000000000},"Counter"),
  g("flow_bytes","flow_bytes","Dataplane","Performance","bytes",SW,{initial:9000000000,step:100000000,min:0,max:1000000000000000},"Counter"),
  g("flow_bytes_total","flow_bytes_total","Dataplane","Performance","bytes",SW,{initial:9000000000,step:110000000,min:0,max:1000000000000000},"Counter"),
  g("flow_duration_sec","flow_duration_sec","Dataplane","Performance","s",SW,{initial:30,step:5,min:0,max:86400}),
  g("pipeline_util_pct","pipeline_util_pct","Dataplane","Capacidade","%",SW,{initial:34,step:9,min:0,max:100}),
  g("port_rx_bps","port_rx_bps","Dataplane","Performance","bps",SW,{initial:320000000,step:90000000,min:0,max:10000000000},"Gauge","number","interface"),
  g("port_tx_bps","port_tx_bps","Dataplane","Performance","bps",SW,{initial:260000000,step:80000000,min:0,max:10000000000},"Gauge","number","interface"),
];

// ──────────────────────────────────────────────────────────────────────────────
// Final assembly
// ──────────────────────────────────────────────────────────────────────────────
export const LAYER_METRICS: Record<MetricLayer, MetricSpec[]> = {
  "L0":            L0,
  "L1":            L1,
  "L2":            L2,
  "L3":            L3,
  "L4":            L4,
  "L5":            L5,
  "L6":            L6,
  "L7":            L7,
  "Control Plane": CONTROL_PLANE,
  "Dataplane":     DATAPLANE,
};

export const METRICS_CATALOG: MetricSpec[] = Object.values(LAYER_METRICS).flat();

export function getLayerMetrics(layer: MetricLayer): MetricSpec[] {
  return LAYER_METRICS[layer] ?? [];
}

export function prettyEntityKind(kind: EntityKind): string {
  if (kind === "switch") return "Switch";
  if (kind === "host") return "Host";
  return "Controlador";
}
