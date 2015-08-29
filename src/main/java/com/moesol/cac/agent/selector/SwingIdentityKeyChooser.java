package com.moesol.cac.agent.selector;

import java.awt.AWTKeyStroke;
import java.awt.KeyboardFocusManager;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

import javax.swing.AbstractAction;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.KeyStroke;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;

public class SwingIdentityKeyChooser {
	public static interface IdentityKeyListProvider {
		CertDescription[] makeCertList(String[] aliases);
	}
	
	private final IdentityKeyListProvider provider;
	private String choosenAlias;
	
	public SwingIdentityKeyChooser(IdentityKeyListProvider provider) {
		this.provider = provider;
	}
	
	public String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException {
		SwingUtilities.invokeAndWait(new Runnable() {
			@Override
			public void run() {
				choosenAlias = pickOnSwingThread(aliases);
			}
		});
		return choosenAlias;
	}
	
	public void reportException(final Exception e) {
		SwingUtilities.invokeLater(new Runnable() {
			@Override
			public void run() {
				JOptionPane.showMessageDialog(null, e.getLocalizedMessage(), "Failed", JOptionPane.ERROR_MESSAGE);
			}
		});
	}
	
	private String pickOnSwingThread(String[] aliases) {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		final JOptionPane pane = new JOptionPane();
		JPanel panel = new JPanel();
		panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));

		JButton preChoosen = null;
		List<JButton> buttons = new ArrayList<JButton>();
		for (final CertDescription cd : provider.makeCertList(aliases)) {
			JButton jb = new JButton(cd.asHtml());
			jb.setHorizontalAlignment(SwingConstants.LEFT);
			jb.addActionListener(new ActionListener() {
				@Override
				public void actionPerformed(ActionEvent e) {
					pane.setValue(cd);
				}
			});
			panel.add(jb);
			buttons.add(jb);

			if (choosenAlias.equals(cd.getAlias())) {
				preChoosen = jb;
			}
		}

		pane.setMessage(panel);
		String cancel = "Cancel";
		pane.setOptions(new Object[] { cancel });

		final JDialog dialog = pane.createDialog("Select Identity");
		bindArrowKeys(dialog);
		panel.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(KeyStroke.getKeyStroke("ENTER"), "selectKey");
		panel.getActionMap().put("selectKey", new AbstractAction() {
			@Override
			public void actionPerformed(ActionEvent e) {
				System.out.println("selectKey");
				if (dialog.getFocusOwner() instanceof JButton) {
					JButton jb = (JButton) dialog.getFocusOwner();
					jb.doClick();
				}
			}
		});
		if (preChoosen != null) {
			preChoosen.requestFocusInWindow();
		}
		
		dialog.setVisible(true);
		Object result = pane.getValue();
		dialog.dispose();

		if (result instanceof CertDescription) {
			CertDescription cd = (CertDescription) result;
			if (cd.getAlias() == null) {
				return null;
			}

			prefs.put("choosenAlias", cd.getAlias());
			try {
				prefs.flush();
			} catch (BackingStoreException e1) {
				e1.printStackTrace();
			}
			return cd.getAlias();
		}
		return null;
	}

	private void bindArrowKeys(JDialog dialog) {
		{
			Set<AWTKeyStroke> forwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newForwardKeys = new HashSet<>(forwardKeys);
			newForwardKeys.add(KeyStroke.getKeyStroke("DOWN"));
			newForwardKeys.add(KeyStroke.getKeyStroke("RIGHT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.FORWARD_TRAVERSAL_KEYS, newForwardKeys);
		}

		{
			Set<AWTKeyStroke> backwardKeys = dialog.getFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS);
			Set<AWTKeyStroke> newBackwardKeys = new HashSet<>(backwardKeys);
			newBackwardKeys.add(KeyStroke.getKeyStroke("UP"));
			newBackwardKeys.add(KeyStroke.getKeyStroke("LEFT"));
			dialog.setFocusTraversalKeys(KeyboardFocusManager.BACKWARD_TRAVERSAL_KEYS, newBackwardKeys);
		}
	}

}
