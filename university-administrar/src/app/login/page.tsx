import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; desativado?: string }>;
}) {
  const { next, desativado } = await searchParams;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">University Administrar</CardTitle>
          <CardDescription>Entre com as credenciais da sua conta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {desativado ? (
            <Alert variant="destructive">
              <AlertTitle>Acesso desativado</AlertTitle>
              <AlertDescription>
                Seu acesso ao University Administrar foi desativado. Procure o administrador.
              </AlertDescription>
            </Alert>
          ) : null}
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </div>
  );
}
