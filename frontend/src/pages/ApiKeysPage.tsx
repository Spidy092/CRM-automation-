import { useState } from 'react';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/api/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Copy, Key, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';

export function ApiKeysPage() {
  const { data: keys = [], refetch, isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState('90');
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Helper to determine the absolute API URL for documentation snippets
  const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL;
    if (envUrl && envUrl.startsWith('http')) {
      return envUrl;
    }
    return `${window.location.origin}${envUrl || '/api/v1'}`;
  };

  const mcpUrl = `${getApiBaseUrl()}/mcp`;

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    }).format(new Date(dateString));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createMutation.mutateAsync({
        name,
        expiresInDays: expiresIn === 'never' ? undefined : parseInt(expiresIn, 10),
      });
      setNewRawKey(result.rawKey);
      setName('');
      refetch();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this API key?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast('Key revoked successfully', 'success');
      refetch();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const copyToClipboard = () => {
    if (newRawKey) {
      navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Copied to clipboard', 'success');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="API Keys"
        description="Manage Personal Access Tokens for MCP and AI agents."
      />

      <Card>
        <CardHeader>
          <CardTitle>Generate New Key</CardTitle>
          <CardDescription>Create a new key to allow an external application or agent to access your CRM data.</CardDescription>
        </CardHeader>
        <CardContent>
          {!newRawKey ? (
            <form onSubmit={handleCreate} className="space-y-4 max-w-md">
              <div className="space-y-2">
                <Label htmlFor="name">Key Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Claude Desktop MCP"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires">Expiration</Label>
                <select
                  id="expires"
                  className="flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="never">Never expire</option>
                </select>
              </div>
              <Button type="submit" disabled={createMutation.isPending || !name}>
                {createMutation.isPending ? 'Generating...' : 'Generate API Key'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div>
                <h4 className="text-sm font-semibold text-amber-800">Save your API Key!</h4>
                <p className="text-sm text-amber-700">
                  This key will only be shown once. Please copy it and save it in a secure location.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input value={newRawKey} readOnly className="font-mono bg-white" />
                <Button type="button" variant="outline" size="icon" onClick={copyToClipboard}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button type="button" variant="secondary" onClick={() => setNewRawKey(null)}>Done</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Keys</CardTitle>
          <CardDescription>Keys that are currently able to access the API.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Loading keys...</TableCell>
                </TableRow>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-slate-500">No active API keys found.</TableCell>
                </TableRow>
              ) : (
                keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-slate-400" />
                        {key.name}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-500">{key.prefix}...</TableCell>
                    <TableCell className="text-slate-500">{formatDate(key.created_at)}</TableCell>
                    <TableCell className="text-slate-500">
                      {key.last_used_at ? formatDate(key.last_used_at) : 'Never'}
                    </TableCell>
                    <TableCell className="text-slate-500">
                      {key.expires_at ? formatDate(key.expires_at) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDelete(key.id)}
                        disabled={deleteMutation.isPending}
                        title="Revoke Key"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to Connect</CardTitle>
          <CardDescription>
            Use your API key to connect an external AI agent to the CRM via the Model Context Protocol (MCP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 border-b pb-2">1. Claude Desktop & Claude Code</h3>
            <div className="text-sm text-slate-600">
              <p className="mb-2">
                Claude Desktop requires a <code>stdio</code> command connector. Add the following to your <code>claude_desktop_config.json</code>:
              </p>
              <div className="rounded-md bg-slate-950 p-4 text-slate-50 overflow-x-auto">
                <pre className="font-mono text-xs">
{`{
  "mcpServers": {
    "crm-automation": {
      "command": "node",
      "args": ["/absolute/path/to/backend/mcp-bridge.js"],
      "env": {
        "CRM_API_KEY": "YOUR_API_KEY_HERE",
        "CRM_MCP_URL": "${mcpUrl}"
      }
    }
  }
}`}
                </pre>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 border-b pb-2">2. Claude Web (claude.ai)</h3>
            <div className="text-sm text-slate-600 space-y-2">
              <p>
                To connect the CRM directly via the Claude Web <strong>Add custom connector</strong> feature:
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Paste the URL below into the <strong>Remote MCP server URL</strong> field, replacing <code>YOUR_API_KEY_HERE</code> with your generated key:</li>
                <code className="block bg-slate-100 p-2 rounded-md font-mono text-xs">{mcpUrl}?apiKey=YOUR_API_KEY_HERE</code>
                <li>You can leave the <strong>Advanced settings</strong> (OAuth Client ID / Secret) completely blank!</li>
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 border-b pb-2">3. Other MCP Clients (HTTP / cURL)</h3>
            <div className="text-sm text-slate-600">
              <p className="mb-2">
                For custom AI agents or scripts, you can communicate directly with the stateless HTTP MCP endpoint:
              </p>
              <div className="rounded-md bg-slate-950 p-4 text-slate-50 overflow-x-auto">
                <pre className="font-mono text-xs">
{`curl -X POST ${mcpUrl} \\
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'`}
                </pre>
              </div>
              <p className="mt-4 text-xs text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-200">
                <strong>Note:</strong> Replace <code>YOUR_API_KEY_HERE</code> with the token you generated above. Any write actions (like creating a campaign or sending messages) will still require human approval via the AI Inbox inside the CRM.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
