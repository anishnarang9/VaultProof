import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';

export default function OperatorGovernance() {
  const { governanceMembers, governanceProposals } = useInstitutionalData();

  return (
    <Tabs defaultValue="proposals">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Badge variant="secondary">Governance</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-text-primary">
            Squads multisig panel
          </h2>
        </div>
        <TabsList>
          <TabsTrigger value="proposals">Proposals</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="proposals">
        <Card>
          <CardHeader>
            <CardTitle>Pending and executed approvals</CardTitle>
            <CardDescription>
              Client-side governance shell using mock proposal data until the final compliance-admin
              wiring is delivered.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proposal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signatures</TableHead>
                  <TableHead>ETA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {governanceProposals.map((proposal) => (
                  <TableRow key={proposal.id}>
                    <TableCell>
                      <div className="text-text-primary">{proposal.title}</div>
                      <div className="mt-1 text-xs leading-5 text-text-tertiary">
                        {proposal.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          proposal.status === 'Executed'
                            ? 'success'
                            : proposal.status === 'Ready'
                              ? 'accent'
                              : 'warning'
                        }
                      >
                        {proposal.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{proposal.signatures}</TableCell>
                    <TableCell>{proposal.eta}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="members">
        <Card>
          <CardHeader>
            <CardTitle>Signer roster</CardTitle>
            <CardDescription>
              Authority routing treats the vault authority and configured Squads members as operator access.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {governanceMembers.map((member, index) => (
              <div
                key={member}
                className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4"
              >
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Signer {index + 1}
                </p>
                <p className="mt-2 font-mono text-xs text-text-secondary">{member}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
