# Checklist VTR

PWA mobile para pesquisar, visualizar e baixar checklist das VTR armazenados no Gmail como anexos PDF.

## Arquitetura

- Sem backend e sem banco de dados.
- Sem Firebase, Supabase ou storage externo.
- Login pelo Google Identity Services.
- Leitura direta pela Gmail API com o escopo somente leitura.
- Client ID e conta autorizada definidos previamente no aplicativo.
- Alteração dessas configurações protegida por senha administrativa.
- Contas Google diferentes da conta autorizada são recusadas após o login.
- Sessão lembrada neste aparelho até o usuário tocar em **Sair**.
- Access token armazenado localmente apenas durante sua validade e renovado pelo Google quando necessário.
- Visualização interna feita pelo PDF.js, sem enviar os documentos a serviços externos.
- Checklist ainda não visualizados ou baixados recebem o selo **NOVO**.
- O contador de novos é mantido localmente e separado por conta autorizada.
- Mensagens específicas orientam sobre internet, sessão, Gmail e anexos inválidos.
- A visualização e o download usam diretamente o PDF original armazenado no Gmail.
- Atualizações do aplicativo ignoram versões antigas mantidas em cache.
- Checklist baixados sob demanda e não persistidos pelo app.

## Configuração do Google Cloud

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou selecione um projeto.
3. Em **APIs e serviços > Biblioteca**, ative a **Gmail API**.
4. Configure a **Tela de consentimento OAuth**.
5. Em **Público-alvo**, use `Externo` e adicione os e-mails permitidos como usuários de teste enquanto o app estiver em teste.
6. Em **Clientes**, crie um Client ID OAuth do tipo **Aplicativo da Web**.
7. Em **Origens JavaScript autorizadas**, adicione a origem em que o app será servido, por exemplo:
   - `http://localhost:8080` para desenvolvimento.
   - `https://seu-dominio.example` para uso no celular.
8. O Client ID e o e-mail autorizado já vêm configurados. Para alterá-los, abra o botão de engrenagem e informe a senha administrativa.

A senha da conta Google não é armazenada no aplicativo. Quando necessária, ela deve ser informada somente na página oficial de autenticação do Google.

O escopo `gmail.readonly` é classificado pelo Google como restrito. Para uso privado em modo de teste, mantenha as contas autorizadas na lista de usuários de teste. Uma publicação ampla pode exigir verificação do Google.

## Executar localmente

Este app precisa ser servido por HTTP; não abra o `index.html` diretamente.

Com Python:

```powershell
python -m http.server 8080 --directory outputs/vtr-pdf-mobile
```

Depois acesse `http://localhost:8080`.

## Instalar no celular

Hospede estes arquivos em uma origem HTTPS. No Android/Chrome, abra o endereço e use **Adicionar à tela inicial** ou **Instalar app**. No iPhone/Safari, use **Compartilhar > Adicionar à Tela de Início**.

O código do app pode ser hospedado como site estático. Os checklist continuam exclusivamente no Gmail como anexos PDF.

## Como a busca funciona

A consulta enviada ao Gmail sempre inclui:

```text
has:attachment filename:pdf
```

O valor de VTR é acrescentado como texto exato. Quando uma data é informada, a busca usa o intervalo daquele dia com os operadores `after:` e `before:` do Gmail.
