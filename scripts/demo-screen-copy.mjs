// Business descriptions for the demo applications, grounded in their captured UI.
// This is fixture copy, not a generic screen recognizer.
export const demoScreenCopy = {
 web: {
  home: ['Início da loja', 'Apresenta a coleção e permite acessar os detalhes do produto em destaque.'],
  product: ['Detalhes do produto', 'Apresenta o produto, seu preço e sua variação, com a opção de adicioná-lo à sacola.'],
  cart: ['Sacola', 'Reúne o produto selecionado e seu valor, permitindo avançar para o pagamento.'],
  payment: ['Pagamento', 'Permite enviar o pedido para concluir a compra.'],
  receipt: ['Confirmação do pedido', 'Confirma a conclusão do pedido, apresenta seu identificador e permite continuar comprando.'],
 },
 android: {
  login: ['Entrar', 'Permite acessar a conta com e-mail e senha ou iniciar a criação de uma conta.'],
  register: ['Criar conta', 'Permite cadastrar uma conta informando nome, e-mail e senha, ou retornar ao acesso de uma conta existente.'],
  home: ['Início', 'Reúne o saldo disponível, a atividade recente e os acessos a Pix, carrinho, cartões e catálogo de produtos.'],
  products: ['Produtos', 'Apresenta o catálogo com nomes, categorias, preços e disponibilidade. Permite consultar detalhes, salvar favoritos e acessar o carrinho.'],
  favorites: ['Favoritos', 'Reúne os produtos salvos pelo cliente para consulta posterior. Permite abrir detalhes, remover favoritos e acessar o carrinho.'],
  product: ['Detalhes do produto', 'Apresenta descrição, preço e disponibilidade do produto. Permite salvar nos favoritos e adicionar ao carrinho quando disponível; produtos esgotados não permitem essa inclusão.'],
  cart: ['Carrinho', 'Reúne os itens escolhidos para compra, permitindo remover produtos e avançar para a confirmação. Quando vazio, oferece acesso ao catálogo.'],
  checkout: ['Confirmar compra', 'Permite revisar os itens, o total, a entrega e o cartão de pagamento antes de confirmar a compra.'],
  receipt: ['Comprovante', 'Apresenta a confirmação de uma compra ou transferência Pix, com valor, identificação, data e detalhes da operação. Permite retornar ao início.'],
  pix: ['Transferir Pix', 'Permite informar chave Pix, valor e descrição opcional, consultar o saldo e acessar transferências anteriores. Encaminha os dados para revisão antes do envio.'],
  'pix-confirm': ['Confirmar Pix', 'Apresenta destinatário, instituição, chave e valor para revisão. Permite confirmar a transferência ou editar os dados; a operação depende de saldo suficiente.'],
  cards: ['Meus cartões', 'Apresenta o cartão, o limite total e o valor disponível, além das solicitações de limite. Permite solicitar um aumento.'],
  'card-limit': ['Aumentar limite', 'Permite informar um novo limite para o cartão e acompanhar a resposta à solicitação, que pode ser aprovada ou recusada.'],
 },
};
