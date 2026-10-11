export type OrderStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'PROVISIONING_FAILED'
  | 'EXPIRED';

export interface PaymentAttempt {
  payment_id: string;
  order_id: string;
  kind: 'PURCHASE' | 'RENEWAL';
  transaction_signature: string | null;
  status: 'PENDING' | 'FINALIZED' | 'FAILED';
  created_at: string;
}

export interface VPSOrder {
  order_id: string;
  server_id?: string;
  name: string;
  owner_wallet: string;
  region: string;
  status: OrderStatus;
  price_lamports: string;
  period_days: number;
  created_at: string;
  paid_until: string | null;
  host: string | null;
  port: number;
  username: string;
  tx_hash: string | null;
  tier_id?: string;
  active_payment_id?: string | null;
}

export type ToastType = 'info' | 'success' | 'error' | 'warn';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export type PlanId = 'edge-micro' | 'validator-dev' | 'rpc-turbo';

export interface HardwarePlan {
  id: PlanId;
  name: string;
  tagline: string;
  badge?: string;
  popular?: boolean;
  vCpu: number;
  cpuModel: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  bandwidth: string;
  portSpeed: string;
  baseWeeklySol: number;
  targetWorkload: string;
}

export type RentalPeriodDays = 7 | 14 | 30 | 90;

export interface DatacenterRegion {
  id: string;
  name: string;
  city: string;
  country: string;
  flag: string;
  pingEstimate: string;
}

export interface DeploymentLifecycleStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  duration: string;
  protocol: string;
  description: string;
  inspectorTitle: string;
  inspectorLanguage: string;
  inspectorContent: string;
  highlights: string[];
}

export interface SecurityPillar {
  id: string;
  title: string;
  badge: string;
  iconName: string;
  description: string;
  technicalSpecs: string[];
}

export interface ArchitectureComponent {
  id: string;
  name: string;
  category: "on-chain" | "gateway" | "vps-daemon" | "client";
  role: string;
  description: string;
  techStack: string;
  sourcePath?: string;
}

export interface OnChainAccount {
  name: string;
  pdaSeeds: string;
  responsibility: string;
  fields: string[];
}

export interface FaqItem {
  id: string;
  category: "all" | "auth" | "billing" | "hardware";
  question: string;
  answer: string;
  highlight?: string;
}



