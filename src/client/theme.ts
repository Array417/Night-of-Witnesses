import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark', primary: { main: '#d7ab64', contrastText: '#20140c' }, secondary: { main: '#bea58b' },
    background: { default: '#120e0c', paper: '#211a16' }, text: { primary: '#f4ead7', secondary: '#bda990' },
    divider: 'rgba(215,171,100,.20)', success: { main: '#95bf9b' }, error: { main: '#ef9b8d' },
  },
  shape: { borderRadius: 14 },
  typography: { fontFamily: '"Noto Sans TC", "Microsoft JhengHei", sans-serif', h1: { fontSize: '2.8rem', fontWeight: 700 }, h2: { fontSize: '1.7rem', fontWeight: 700 }, h3: { fontSize: '1.15rem', fontWeight: 700 }, button: { fontWeight: 700, textTransform: 'none' } },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44, paddingInline: 20 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTextField: { defaultProps: { fullWidth: true, variant: 'outlined' } },
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: 'sm' } },
  },
});
