import { NavLink, Outlet } from 'react-router-dom';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  BarChart3,
  Eye,
  Landmark,
  ShieldCheck,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import { BrandMark } from './AppChrome';
import { cn } from '../../lib/utils';

const navItems = [
  { icon: BarChart3, label: 'Dashboard', to: '/developer' },
  { icon: UserPlus, label: 'KYC Onboarding', to: '/developer/onboard' },
  { icon: TrendingUp, label: 'Yield Management', to: '/developer/yield' },
  { icon: ShieldCheck, label: 'Risk Controls', to: '/developer/risk' },
  { icon: Landmark, label: 'Governance', to: '/developer/governance' },
  { icon: Eye, label: 'Compliance', to: '/developer/compliance' },
];

export default function DeveloperLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-border bg-surface">
        <div className="px-6 py-6">
          <NavLink to="/">
            <BrandMark />
          </NavLink>
          <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
            Developer Console
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-elevated/60 hover:text-text-primary',
                  )
                }
                end={item.to === '/developer'}
                to={item.to}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4">
          <WalletMultiButton />
        </div>
      </aside>

      <main className="min-h-screen flex-1 pl-[260px]">
        <div className="px-8 py-8 lg:px-12 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
