import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    }
  },
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== 'undefined') {
  window.ResizeObserver = ResizeObserverMock;
}
global.ResizeObserver = ResizeObserverMock;


import { ToastProvider } from '@/components/ui/Toast';

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { initialEntries?: string[] }
) => {
  const testQueryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    return (
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={options?.initialEntries || ['/']}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  return render(ui, { wrapper: Wrapper, ...options });
};

export * from '@testing-library/react';
