# Checklist VTR

PWA mobile para pesquisar, visualizar e baixar checklist das VTR armazenados no Gmail como anexos PDF.

## Arquitetura

- Sem backend e sem banco de dados.
- Sem Firebase, Supabase ou storage externo.
- Login pelo Google Identity Services.
- Leitura direta pela Gmail API com o escopo somente leitura.
- Access token mantido apenas em memória.
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
8. Abra o app, toque em **Configurar agora** e informe o Client ID terminado em `.apps.googleusercontent.com`.

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
