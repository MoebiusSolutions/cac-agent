package com.moesol.cac.agent.selector;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;
import java.security.KeyStore;
import java.security.KeyStore.CallbackHandlerProtection;
import java.security.Provider;
import java.security.Security;

import javax.security.auth.callback.Callback;
import javax.security.auth.callback.CallbackHandler;
import javax.security.auth.callback.PasswordCallback;
import javax.security.auth.callback.UnsupportedCallbackException;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.SwingUtilities;

import com.moesol.url.CacHookingAgent;

public class Pkcs11SelectorKeyManager extends AbstractSelectorKeyManager {

	private Provider provider;
	private JDialog busy;

	@Override
	protected KeyStore accessKeyStore() throws Exception {
		setUpProvider();
		
		showBusy("Accessing CAC...");
		try {
			KeyStore ks = KeyStore.Builder
					.newInstance("PKCS11", provider, makeCallbackHandler())
					.getKeyStore();
			ks.load(null, null);
			return ks;
		} finally {
			hideBusy();
		}
	}
	
	private CallbackHandlerProtection makeCallbackHandler() {
		CallbackHandler handler = new CallbackHandler() {
			@Override
			public void handle(Callback[] callbacks) throws IOException,
					UnsupportedCallbackException {
				for (Callback c : callbacks) {
					if (c instanceof PasswordCallback) {
						PasswordCallback pc = (PasswordCallback) c;
						pc.setPassword(promptForPin(pc.getPrompt()));
					}
				}
			}
		};
		return new KeyStore.CallbackHandlerProtection(handler);		
	}
	
	@SuppressWarnings("restriction")
	private void setUpProvider() {
		showBusy("Initializing PKCS#11...");
		try {
			String home = System.getProperty("user.home");
			String configName = home + "/" + CacHookingAgent.CAC_AGENT_DIR + "/pkcs11.cfg";
			File configFile = new File(configName);
			if (configFile.exists()) {
				provider = new sun.security.pkcs11.SunPKCS11(configName);
				Security.addProvider(provider);	
			} else {
				String message = "Not found: " + configName;
				String title = "PKCS#11 Configuration Not Loaded";
				JOptionPane.showMessageDialog(null, message, title, JOptionPane.WARNING_MESSAGE);
			}
		} finally {
			hideBusy();
		}
	}

	private void showBusy(final String message) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane pane = new JOptionPane(message, JOptionPane.INFORMATION_MESSAGE);
				busy = pane.createDialog("CAC");
				busy.setModal(false);
				busy.setVisible(true);
			}
		});
	}

	private void hideBusy() {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				busy.setVisible(false);
				busy.dispose();
				busy = null;
			}
		});
	}

	private char[] promptForPin(String prompt) {
		JLabel label = new JLabel("Enter CAC PIN:");
		final JPasswordField pass = new JPasswordField(10);

		JPanel panel = new JPanel();
		panel.add(label);
		panel.add(pass);
		
		final JOptionPane pane = new JOptionPane();
		pane.setMessage(panel);
		pane.setMessageType(JOptionPane.QUESTION_MESSAGE);
		pane.setOptionType(JOptionPane.OK_CANCEL_OPTION);
		JDialog dialog = pane.createDialog(busy, "CAC");
		dialog.addWindowFocusListener(new WindowAdapter() {
		    public void windowGainedFocus(WindowEvent e) {
		    	pass.requestFocusInWindow();
		    }
		});
		pass.addActionListener(new ActionListener() {
			@Override
			public void actionPerformed(ActionEvent e) {
				pane.setValue(0);
			}
		});
		dialog.setVisible(true);
		Object result = pane.getValue();
		dialog.dispose();
		
		if (new Integer(0).equals(result)) {
			return pass.getPassword();
		}
		return null;
	}

	public static void main(String[] args) {
//		CacHookingAgent.DEBUG = true;
		Pkcs11SelectorKeyManager selector = new Pkcs11SelectorKeyManager();
		selector.setIdentityKeyChooser(new TtyIdentityKeyChooser(selector));
		
		System.out.println("chose: "
				+ selector.chooseClientAlias(null, null, null));
		// Must not need to call System.exit(0) to shutdown or interferes with jgit.
	}

}
